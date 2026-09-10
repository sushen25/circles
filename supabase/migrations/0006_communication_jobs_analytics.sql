-- Communication, jobs and analytics: the tables that never face a client.
--
-- Three schemas, one rule: `anon` and `authenticated` hold nothing here. 0001
-- revoked the schemas and set default privileges; this migration creates the
-- tables, grants the service role, and enables RLS on every one of them
-- anyway, so that a grant made by mistake later still meets an empty policy
-- set. `070_communication_jobs.sql` walks the catalogue and fails the build
-- if a client role can reach any table or function in these schemas.
--
-- The centrepiece is the outbox (ADR 0003): every state-changing function
-- appends a row in the same transaction as its change, and the dispatcher
-- (S1-20) drains it in order. Four writers have been owing events since
-- S1-07 — `020_outbox_dependency.sql` failed the build the moment this table
-- appeared — and they are paid here.

-- ---------------------------------------------------------------------------
-- The service role in the private schemas.
--
-- A custom schema grants no `usage` by default (0003 learnt this for
-- `planning`). The service role is the Edge Functions, and they are the only
-- client of these schemas.
-- ---------------------------------------------------------------------------

grant usage on schema private to service_role;
grant usage on schema jobs to service_role;
grant usage on schema analytics to service_role;

-- ---------------------------------------------------------------------------
-- Non-negotiable 8, as a function.
--
-- Three tables here hold free-form JSON that is read by the dispatcher, the
-- notification pipeline and analytics, and none of them may be handed a
-- name, an email, a note, a title or a token. This walks the whole document —
-- objects inside arrays inside objects — because a check that looks only at
-- the top level is a promise about the shape the writer happened to use, and
-- `{"context": {"email": …}}` is a payload somebody will write in good faith.
-- ---------------------------------------------------------------------------

create or replace function jobs.carries_content(p_document jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with recursive nodes (node) as (
    select p_document
    union all
    select child
    from nodes,
    lateral (
      select value from jsonb_each(case when jsonb_typeof(node) = 'object' then node else '{}'::jsonb end)
      union all
      select value from jsonb_array_elements(case when jsonb_typeof(node) = 'array' then node else '[]'::jsonb end)
    ) as children (child)
  )
  select exists (
    select 1
    from nodes, jsonb_object_keys(case when jsonb_typeof(node) = 'object' then node else '{}'::jsonb end) as k
    where lower(k) in (
      'name', 'display_name', 'display_name_snapshot', 'email', 'email_normalized', 'note',
      'title', 'token', 'token_hash', 'place_name', 'cancel_note'
    )
  );
$$;

comment on function jobs.carries_content(jsonb) is
  'True when any object at any depth carries a key that names a person, an address, a note, a title or a token. The check constraint on outbox, audit_log and analytics.events.';

-- ---------------------------------------------------------------------------
-- jobs.outbox
-- ---------------------------------------------------------------------------

create table jobs.outbox (
  id uuid primary key default gen_random_uuid(),
  -- Drain order. `occurred_at` ties within a transaction; this does not.
  seq bigint generated always as identity,
  event_name text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  -- The catalogue in architecture §6.3, as a constraint. A misspelt event is
  -- an event nobody consumes, and the build should say so before a dispatcher
  -- quietly skips it.
  constraint outbox_event_name check (event_name in (
    'circles.circle_created', 'circles.member_joined', 'circles.member_removed',
    'circles.invite_rotated', 'circles.member_reattached',
    'planning.plan_created', 'planning.plan_revised', 'planning.plan_expired',
    'planning.plan_cancelled', 'planning.quiet_ask_created', 'planning.interest_recorded',
    'planning.threshold_reached', 'planning.organiser_accepted', 'planning.deadline_passed',
    'availability.response_submitted', 'availability.response_cleared',
    'scheduling.candidates_generated', 'scheduling.no_eligible_candidates',
    'confirmation.meetup_confirmed', 'confirmation.meetup_rescheduled', 'confirmation.meetup_cancelled',
    'confirmation.attendance_updated', 'confirmation.outcome_reported',
    'communication.contact_verified', 'communication.subscription_changed', 'communication.delivery_recorded',
    'growth.nudge_shown', 'growth.nudge_answered', 'growth.account_claimed'
  )),
  constraint outbox_aggregate_type check (aggregate_type in (
    'circle', 'plan', 'response', 'confirmation', 'contact', 'subscription', 'delivery', 'nudge', 'account'
  )),
  constraint outbox_payload_is_object check (jsonb_typeof(payload) = 'object'),
  -- Non-negotiable 8, at the table. Ids only, at every depth.
  constraint outbox_payload_carries_no_content check (not jobs.carries_content(payload)),
  constraint outbox_attempts check (attempts >= 0)
);

comment on table jobs.outbox is
  'Domain events, appended in the same transaction as the change they describe (ADR 0003). Drained in `seq` order by process-scheduled-jobs; pruned after 30 days.';

create index outbox_unprocessed_idx on jobs.outbox (seq) where processed_at is null;
create index outbox_aggregate_idx on jobs.outbox (aggregate_type, aggregate_id);

-- The one way in. Definer, so that a trigger firing as a member can append
-- without the member holding anything in `jobs`; callable by the service
-- role, so an Edge Function can announce what it did (invite rotated,
-- contact verified, nudge shown) without a table grant.
create or replace function jobs.emit(
  p_event_name text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into jobs.outbox (event_name, aggregate_type, aggregate_id, payload)
  values (p_event_name, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb))
  returning id;
$$;

comment on function jobs.emit(text, text, uuid, jsonb) is
  'Appends one domain event to the outbox. Every definer function and the service role write events through this; nothing else inserts into jobs.outbox.';

-- ---------------------------------------------------------------------------
-- jobs.notification_jobs
--
-- The idempotency key is the whole design (§13): `hash(channel, recipient,
-- plan, revision, kind, occurrence)`, computed by `idempotencyKey` in
-- `packages/domain/communication` — 64 hex characters of SHA-256 — and unique
-- here, so a retry cannot send twice however it retries.
-- ---------------------------------------------------------------------------

create table jobs.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  -- `NotificationKind` in packages/domain/communication/kinds.ts.
  kind text not null,
  user_id uuid references auth.users (id) on delete cascade,
  contact_id uuid,
  plan_id uuid references public.plans (id) on delete cascade,
  plan_revision integer,
  scheduled_for timestamptz not null,
  idempotency_key text not null unique,
  status text not null default 'scheduled',
  attempt_count integer not null default 0,
  last_error text,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_jobs_channel check (channel in ('push', 'email')),
  constraint notification_jobs_kind check (kind in (
    'new_plan', 'quiet_ask', 'threshold_initiator', 'threshold_keen', 'deadline_approaching',
    'options_ready', 'replies_closed', 'locked_in', 'changed', 'cancelled', 'reminder',
    'did_it_happen', 'about_time', 'did_it_happen_participant', 'verify_email'
  )),
  constraint notification_jobs_status check (status in ('scheduled', 'sent', 'failed', 'skipped')),
  constraint notification_jobs_key_shape check (idempotency_key ~ '^[0-9a-f]{64}$'),
  constraint notification_jobs_attempts check (attempt_count >= 0),
  -- A push goes to a user; an email goes to a contact. Written as a `case` so
  -- that a null in the wrong column is a refusal, not a pass.
  constraint notification_jobs_recipient check (
    case channel
      when 'push' then user_id is not null
      when 'email' then contact_id is not null
    end
  ),
  constraint notification_jobs_sent_shape check (
    case status when 'sent' then sent_at is not null else sent_at is null end
  )
);

comment on table jobs.notification_jobs is
  'One row per (channel, recipient, plan, revision, kind, occurrence), keyed by the SHA-256 the domain computes. Created by the dispatcher before any external call; never by a client.';

create index notification_jobs_due_idx on jobs.notification_jobs (status, scheduled_for);
create index notification_jobs_plan_idx on jobs.notification_jobs (plan_id);

-- ---------------------------------------------------------------------------
-- jobs.cron_leases
--
-- One row per scheduled job name. The dispatcher takes the row `for update`,
-- refuses to run while `leased_until` is in the future and held by somebody
-- else, and writes its own name and a deadline before doing anything (ADR
-- 0003: "under a lease row"). S1-12 seeds the names.
-- ---------------------------------------------------------------------------

create table jobs.cron_leases (
  name text primary key,
  leased_until timestamptz,
  holder text,
  last_started_at timestamptz,
  last_finished_at timestamptz
);

comment on table jobs.cron_leases is
  'One row per cron job. process-scheduled-jobs runs only while it holds the lease; two invocations a minute apart cannot overlap.';

-- ---------------------------------------------------------------------------
-- private.push_devices (Slice 3 writes it; created now so the pipeline has
-- one shape to target)
-- ---------------------------------------------------------------------------

create table private.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  enabled boolean not null default true,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_devices_platform check (platform in ('ios', 'android'))
);

create index push_devices_user_idx on private.push_devices (user_id);

-- ---------------------------------------------------------------------------
-- private.email_contacts
--
-- The address lives here and nowhere else (§14): never in a DTO, an event, a
-- log or `analytics`. The hash is for dedupe and for the "already suppressed"
-- lookup, so that a resubmitted suppressed address is met with neutral
-- guidance and never reactivated by accident (spec §9).
-- ---------------------------------------------------------------------------

create table private.email_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_normalized text not null,
  -- SHA-256 of `email_normalized`; 32 bytes.
  email_hash bytea not null unique,
  status text not null default 'pending',
  verified_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_contacts_status check (status in ('pending', 'verified', 'suppressed')),
  constraint email_contacts_hash_length check (octet_length(email_hash) = 32),
  constraint email_contacts_normalized check (
    email_normalized = lower(btrim(email_normalized)) and email_normalized ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  constraint email_contacts_reason check (
    suppression_reason is null or suppression_reason in ('bounced', 'complained', 'unsubscribed', 'deleted')
  ),
  -- Suppression is a state with a time and a reason, and a verified contact
  -- has a time it was verified. A `case`, so a null does not pass.
  constraint email_contacts_shape check (
    case status
      when 'pending' then verified_at is null and suppressed_at is null and suppression_reason is null
      when 'verified' then verified_at is not null and suppressed_at is null and suppression_reason is null
      when 'suppressed' then suppressed_at is not null and suppression_reason is not null
    end
  )
);

comment on table private.email_contacts is
  'The only table holding an email address. Hashed for dedupe; suppressed on bounce or complaint immediately and never automatically reactivated (§13, spec §9).';

create index email_contacts_user_idx on private.email_contacts (user_id);

-- ---------------------------------------------------------------------------
-- private.email_subscriptions
--
-- Consent is per plan (`plan_updates`) and is the whole of email in the MVP:
-- product-marketing consent is not here (spec §3). The consent text version
-- is recorded with the consent, because a record of consent that cannot say
-- what was consented to is not one.
-- ---------------------------------------------------------------------------

create table private.email_subscriptions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references private.email_contacts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null,
  plan_id uuid references public.plans (id) on delete cascade,
  status text not null default 'active',
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  consent_text_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_subscriptions_scope check (scope in ('plan_updates')),
  constraint email_subscriptions_status check (status in ('active', 'withdrawn')),
  constraint email_subscriptions_plan_required check (
    case scope when 'plan_updates' then plan_id is not null end
  ),
  constraint email_subscriptions_withdrawn_shape check (
    case status when 'withdrawn' then withdrawn_at is not null else withdrawn_at is null end
  )
);

comment on table private.email_subscriptions is
  'Consent to plan-update email, per contact per plan, with the consent text version. Withdrawal is immediate (§14: Spam Act).';

create unique index email_subscriptions_one_per_plan_idx
  on private.email_subscriptions (contact_id, scope, plan_id);
create index email_subscriptions_plan_idx on private.email_subscriptions (plan_id);

-- ---------------------------------------------------------------------------
-- private.email_action_tokens
--
-- The token itself is never stored: ≥256 bits in the link, SHA-256 here,
-- single use, expiring (§14). "Single use" is `used_at`, and it is the
-- consuming function's job (S1-18) to set it in the same statement that
-- reads the row — `update … where token_hash = $1 and used_at is null and
-- expires_at > now() returning …` — so two clicks on one link cannot both
-- succeed.
-- ---------------------------------------------------------------------------

create table private.email_action_tokens (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references private.email_contacts (id) on delete cascade,
  purpose text not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  -- A re-entry token returns somebody to a membership without a sign-in
  -- (spec §5.11). `circle_members` is keyed by the pair.
  membership_circle_id uuid,
  membership_user_id uuid,
  created_at timestamptz not null default now(),
  constraint email_action_tokens_purpose check (purpose in ('verify', 'prefs', 'reentry')),
  constraint email_action_tokens_hash_length check (octet_length(token_hash) = 32),
  constraint email_action_tokens_membership_for_reentry check (
    case purpose
      when 'reentry' then membership_circle_id is not null and membership_user_id is not null
      else membership_circle_id is null and membership_user_id is null
    end
  ),
  foreign key (membership_circle_id, membership_user_id)
    references public.circle_members (circle_id, user_id) on delete cascade
);

comment on table private.email_action_tokens is
  'Hashes of verification, preference and re-entry tokens. The token is in the link and nowhere else; single use by `used_at`; never logged.';

create index email_action_tokens_contact_idx on private.email_action_tokens (contact_id);
create index email_action_tokens_expiry_idx on private.email_action_tokens (expires_at) where used_at is null;

-- ---------------------------------------------------------------------------
-- private.email_delivery_events
--
-- What the provider said about a message, stored once: the webhook can be
-- retried and the unique pair makes the second delivery of the same event a
-- no-op rather than a second suppression or a second analytics row.
-- ---------------------------------------------------------------------------

create table private.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs.notification_jobs (id) on delete set null,
  provider_message_id text not null,
  event_type text not null,
  provider_occurred_at timestamptz,
  recorded_at timestamptz not null default now(),
  constraint email_delivery_events_type check (
    event_type in ('sent', 'delivered', 'bounced', 'complained', 'deferred', 'failed')
  ),
  unique (provider_message_id, event_type)
);

comment on table private.email_delivery_events is
  'Provider delivery events, one row per (message, type). `bounced` and `complained` suppress the contact immediately (§13).';

create index email_delivery_events_job_idx on private.email_delivery_events (job_id);

-- ---------------------------------------------------------------------------
-- private.audit_log
-- ---------------------------------------------------------------------------

create table private.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_log_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  constraint audit_log_metadata_carries_no_content check (not jobs.carries_content(metadata))
);

comment on table private.audit_log is
  'Who did what to which resource, by id. Kept 12 months (§8.5). Never a name, an email or a note.';

create index audit_log_resource_idx on private.audit_log (resource_type, resource_id);
create index audit_log_occurred_idx on private.audit_log (occurred_at);

-- ---------------------------------------------------------------------------
-- analytics.events
--
-- Insert-only. Validated against the typed catalogue in
-- `packages/contracts/analytics.ts` by the ingest function (S1-21), which is
-- where "nothing in properties may be a name, email, note, token or title"
-- (§15) is enforced; the constraint below is the same rule at the table, for
-- the day the ingest function has a bug. No foreign keys: an event outlives
-- the row it was about, and account deletion nulls the identifiers rather
-- than deleting the history (§14).
-- ---------------------------------------------------------------------------

create table analytics.events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  schema_version integer not null,
  user_id uuid,
  anonymous_id text,
  circle_id uuid,
  plan_id uuid,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  constraint events_schema_version check (schema_version >= 1),
  constraint events_properties_is_object check (jsonb_typeof(properties) = 'object'),
  constraint events_properties_carry_no_content check (not jobs.carries_content(properties))
);

comment on table analytics.events is
  'Product events, validated against packages/contracts/analytics.ts on ingest. Insert-only; the founder views (S1-21) read it.';

create index events_name_time_idx on analytics.events (event_name, occurred_at);
create index events_circle_idx on analytics.events (circle_id, occurred_at);

-- ---------------------------------------------------------------------------
-- public.nudge_states
--
-- The one growth table, and the one table in this migration a client writes.
-- "At most once per moment per plan" (spec §5.11) is the unique index; the
-- caps and the 30-day back-off are `packages/domain` rules the client
-- evaluates over these rows. `plan_id` is null for a moment that is not about
-- a plan — `reattached`, `settings` — and `nulls not distinct` keeps the
-- once-per-moment rule for those too.
-- ---------------------------------------------------------------------------

create table public.nudge_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The union of the two `moment` enums in packages/contracts/analytics.ts:
  -- app nudges and saved-place prompts.
  moment text not null,
  plan_id uuid references public.plans (id) on delete cascade,
  shown_at timestamptz not null default now(),
  answer text,
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nudge_states_moment check (moment in (
    'confirmed', 'reattached', 'second_response', 'after_attendance',
    'after_answer', 'after_confirmed', 'settings'
  )),
  constraint nudge_states_answer check (answer is null or answer in ('dismissed', 'tapped')),
  -- A moment is about a plan or it is not, and the row says which the same
  -- way every time: a `confirmed` without a plan would consume the
  -- once-per-moment key for no plan at all, and a `settings` with one would
  -- be a second `settings`. A `case`, so a null does not pass.
  constraint nudge_states_plan_shape check (
    case moment
      when 'reattached' then plan_id is null
      when 'settings' then plan_id is null
      else plan_id is not null
    end
  ),
  unique nulls not distinct (user_id, moment, plan_id)
);

comment on table public.nudge_states is
  'One row per (user, moment, plan): a prompt shown, and what was done with it. Own rows only; the eligibility rules are in packages/domain.';

create trigger nudge_states_touch_updated_at
  before update on public.nudge_states
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- updated_at, on the private tables that have one
-- ---------------------------------------------------------------------------

create trigger notification_jobs_touch_updated_at
  before update on jobs.notification_jobs
  for each row execute function public.touch_updated_at();
create trigger push_devices_touch_updated_at
  before update on private.push_devices
  for each row execute function public.touch_updated_at();
create trigger email_contacts_touch_updated_at
  before update on private.email_contacts
  for each row execute function public.touch_updated_at();
create trigger email_subscriptions_touch_updated_at
  before update on private.email_subscriptions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Paying the debt: the events owed since S1-07.
--
-- Two kinds of writer. A *fact about a row* — a circle exists, a member
-- joined or was removed, an answer was given, an attendance changed — is
-- announced by a trigger on the row, so every writer announces it: the
-- function that exists today, the Edge Function that inserts as the service
-- role tomorrow, and the one nobody has written yet. A *transition* is
-- announced by `transition_plan`, because only it knows which action was
-- taken — the row diff of `collecting → collecting` cannot tell an `edit`
-- from an `accept_organiser`, and deriving the action from the shape it left
-- behind is the guard-checks-the-form mistake with an event name on it.
--
-- The trigger functions are definer: a member who inserts their own
-- attendance holds nothing in `jobs`, and must not need to.
-- ---------------------------------------------------------------------------

create or replace function jobs.on_circle_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform jobs.emit('circles.circle_created', 'circle', new.id, jsonb_build_object(
    'circle_id', new.id,
    'owner_user_id', new.owner_user_id,
    'cadence', new.cadence,
    'time_zone', new.time_zone
  ));
  return new;
end;
$$;

create trigger circles_emit_created
  after insert on public.circles
  for each row execute function jobs.on_circle_created();

create or replace function jobs.on_member_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform jobs.emit('circles.member_joined', 'circle', new.circle_id, jsonb_build_object(
      'circle_id', new.circle_id,
      'user_id', new.user_id,
      'role', new.role
    ));
  elsif new.status = 'removed' and old.status <> 'removed' then
    perform jobs.emit('circles.member_removed', 'circle', new.circle_id, jsonb_build_object(
      'circle_id', new.circle_id,
      'user_id', new.user_id
    ));
  end if;
  return new;
end;
$$;

create trigger circle_members_emit_changed
  after insert or update of status on public.circle_members
  for each row execute function jobs.on_member_changed();

-- One row per answer: `replace_response` upserts the response row exactly
-- once per call (0004), so this is one event per answer, not one per window.
-- A deleted answer is a cleared one — removal deletes them (§4.5) — unless
-- the plan itself is going, in which case there is nobody left to tell.
create or replace function jobs.on_response_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.plans p where p.id = old.plan_id) then
      perform jobs.emit('availability.response_cleared', 'plan', old.plan_id, jsonb_build_object(
        'plan_id', old.plan_id,
        'revision', old.revision,
        'user_id', old.user_id
      ));
    end if;
    return old;
  end if;
  perform jobs.emit('availability.response_submitted', 'plan', new.plan_id, jsonb_build_object(
    'plan_id', new.plan_id,
    'revision', new.revision,
    'user_id', new.user_id,
    'status', new.status,
    'used_calendar_overlay', new.used_calendar_overlay
  ));
  return new;
end;
$$;

create trigger plan_responses_emit_changed
  after insert or update or delete on public.plan_responses
  for each row execute function jobs.on_response_changed();

-- An update that changed the status. The `before` trigger in 0005 turns a
-- repeat of the same status into a no-op by returning the old row; the
-- `after` trigger still fires, so the comparison is made again here. The
-- derived rows written at confirmation are inserts, and are not "updates"
-- anybody made.
create or replace function jobs.on_attendance_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_id uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  select c.plan_id into plan_id from public.meetup_confirmations c where c.id = new.confirmation_id;
  perform jobs.emit('confirmation.attendance_updated', 'confirmation', new.confirmation_id, jsonb_build_object(
    'confirmation_id', new.confirmation_id,
    'plan_id', plan_id,
    'user_id', new.user_id,
    'status', new.status
  ));
  return new;
end;
$$;

create trigger attendance_emit_updated
  after update of status on public.attendance
  for each row execute function jobs.on_attendance_updated();

-- The transition → event map. Immutable and total over `planning.transitions`;
-- `075_outbox_events.sql` walks that table and fails if a row maps to null,
-- so a transition added by the generator cannot arrive silent.
create or replace function planning.event_for(p_from_state text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'create_named' then 'planning.plan_created'
    when 'create_quiet' then 'planning.quiet_ask_created'
    when 'threshold_reached' then 'planning.threshold_reached'
    when 'expire' then 'planning.plan_expired'
    when 'accept_organiser' then 'planning.organiser_accepted'
    when 'edit' then 'planning.plan_revised'
    when 'candidates_ready' then 'scheduling.candidates_generated'
    when 'candidates_gone' then 'scheduling.no_eligible_candidates'
    when 'confirm' then 'confirmation.meetup_confirmed'
    when 'reopen' then 'confirmation.meetup_rescheduled'
    when 'report_outcome' then 'confirmation.outcome_reported'
    -- Cancelling a confirmed meetup is a different message from withdrawing
    -- an ask: "Thursday is off" goes to everyone who had it in a calendar.
    when 'cancel' then case p_from_state
      when 'confirmed' then 'confirmation.meetup_cancelled'
      else 'planning.plan_cancelled'
    end
    else null
  end;
$$;

comment on function planning.event_for(text, text) is
  'The outbox event a transition announces. Total over planning.transitions, by test.';

-- transition_plan, redefined whole from 0004 with the emit in place of the
-- TODO. The body is otherwise byte-for-byte 0004's; the diff of this file
-- against that one is the review.
create or replace function planning.transition_plan(
  p_plan_id uuid,
  p_action text,
  p_actor uuid,
  p_payload jsonb default '{}'::jsonb
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  rule planning.transitions;
  member public.circle_members;
  is_permanent boolean;
  guard text;
  next_revision integer;
  event_name text;
  event_payload jsonb;
begin
  select * into plan from public.plans where id = p_plan_id for update;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into rule
  from planning.transitions t
  where t.from_state = plan.state and t.action = p_action;

  if not found then
    if plan.state in ('completed', 'expired', 'cancelled') then
      raise exception 'plan_is_finished' using errcode = 'P0001';
    end if;
    raise exception 'wrong_state' using errcode = 'P0001';
  end if;

  select * into member
  from public.circle_members m
  where m.circle_id = plan.circle_id and m.user_id = p_actor and m.status = 'active';

  select p.is_permanent into is_permanent
  from public.profiles p where p.user_id = p_actor;

  -- Shape before semantics, and this is a reorder from 0003: a caller who sent
  -- a key the action does not take should learn that first, rather than only
  -- after producing a candidate the guard accepts.
  if exists (
    select 1 from jsonb_object_keys(p_payload) k
    where k <> all (planning.allowed_keys(p_action))
  ) then
    raise exception 'unexpected_payload' using errcode = 'P0001';
  end if;

  foreach guard in array rule.guards loop
    case guard
      when 'member' then
        if member.user_id is null then
          raise exception 'not_a_member' using errcode = 'P0001';
        end if;
      when 'organiser' then
        if plan.organiser_user_id is distinct from p_actor or member.user_id is null then
          raise exception 'not_the_organiser' using errcode = 'P0001';
        end if;
      when 'permanent' then
        if not coalesce(is_permanent, false) then
          raise exception 'needs_permanent_identity' using errcode = 'P0001';
        end if;
      when 'no_organiser_yet' then
        if plan.organiser_user_id is not null then
          raise exception 'already_has_organiser' using errcode = 'P0001';
        end if;
      when 'initiator' then
        if not exists (
          select 1 from private.plan_initiators pi
          where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
        ) then
          raise exception 'not_the_initiator' using errcode = 'P0001';
        end if;
      when 'keen_initiator_or_owner' then
        if not exists (
          select 1 from private.plan_interest i
          where i.plan_id = plan.id and i.user_id = p_actor and i.response = 'keen'
        ) and not exists (
          select 1 from private.plan_initiators pi
          where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
        ) and not exists (
          select 1 from public.circles c
          where c.id = plan.circle_id and c.owner_user_id = p_actor
        ) then
          raise exception 'not_keen_initiator_or_owner' using errcode = 'P0001';
        end if;
      when 'threshold' then
        if plan.quiet_threshold is null or (
          select count(*) from private.plan_interest i
          where i.plan_id = plan.id and i.response = 'keen'
        ) < plan.quiet_threshold then
          raise exception 'threshold_not_reached' using errcode = 'P0001';
        end if;
      when 'candidate' then
        -- Eligibility, not presence. This is the line 0003 could not write.
        if not planning.candidate_is_eligible(plan, p_payload ->> 'candidate_id') then
          raise exception 'needs_candidate' using errcode = 'P0001';
        end if;
      else
        raise exception 'UNKNOWN_GUARD_%', guard using errcode = 'P0001';
    end case;
  end loop;

  next_revision := plan.revision + (case when rule.bumps_revision then 1 else 0 end);

  perform set_config('circles.in_transition', 'on', true);

  update public.plans p set
    state = rule.to_state,
    revision = next_revision,
    input_version = case when rule.bumps_revision then 1 else p.input_version end,
    organiser_user_id = case
      when p_action = 'accept_organiser' then p_actor
      else p.organiser_user_id
    end,
    window_start = coalesce((p_payload ->> 'window_start')::date, p.window_start),
    window_end = coalesce((p_payload ->> 'window_end')::date, p.window_end),
    daily_start_local = coalesce((p_payload ->> 'daily_start_local')::integer, p.daily_start_local),
    daily_end_local = coalesce((p_payload ->> 'daily_end_local')::integer, p.daily_end_local),
    duration_minutes = coalesce((p_payload ->> 'duration_minutes')::integer, p.duration_minutes),
    quorum = coalesce((p_payload ->> 'quorum')::integer, p.quorum),
    response_deadline = coalesce((p_payload ->> 'response_deadline')::timestamptz, p.response_deadline),
    cancel_note = case
      when rule.to_state = 'cancelled' then p_payload ->> 'cancel_note'
      else p.cancel_note
    end
  where p.id = p_plan_id
  returning * into plan;

  perform set_config('circles.in_transition', 'off', true);

  -- The event, in the same transaction as the change (ADR 0003). Its name
  -- comes from the transition, not from the caller, and a transition without
  -- a name is refused rather than silently unannounced — `075_outbox_events`
  -- walks the table so a new row cannot arrive without one.
  event_name := planning.event_for(rule.from_state, p_action);
  if event_name is null then
    raise exception 'no outbox event for transition % / %', rule.from_state, p_action
      using errcode = 'P0001';
  end if;

  -- What the payload may say. The actor is never named as such: on a quiet ask
  -- the actor of `create_quiet` and of `cancel` is the initiator, whose
  -- identity is the one thing the row must never say (§14). The organiser is a
  -- public fact and is carried once accepted; a threshold event carries the
  -- plan and the keen count only (§6.3).
  event_payload := jsonb_build_object(
    'plan_id', plan.id,
    'circle_id', plan.circle_id,
    'mode', plan.mode,
    'action', p_action,
    'from_state', rule.from_state,
    'to_state', plan.state,
    'revision', plan.revision
  );
  if plan.organiser_user_id is not null then
    event_payload := event_payload || jsonb_build_object('organiser_user_id', plan.organiser_user_id);
  end if;
  if p_action = 'threshold_reached' then
    event_payload := event_payload || jsonb_build_object('keen_count', (
      select count(*) from private.plan_interest i
      where i.plan_id = plan.id and i.response = 'keen'
    ));
  end if;
  if p_action = 'confirm' then
    event_payload := event_payload || jsonb_build_object('candidate_id', p_payload ->> 'candidate_id');
  end if;
  perform jobs.emit(event_name, 'plan', plan.id, event_payload);


  return plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- RLS on, no policies: even a grant made by mistake meets an empty policy set.
-- The service role bypasses RLS and the owner bypasses it as owner; nobody
-- else is meant to be here.
alter table jobs.outbox enable row level security;
alter table jobs.notification_jobs enable row level security;
alter table jobs.cron_leases enable row level security;
alter table private.push_devices enable row level security;
alter table private.email_contacts enable row level security;
alter table private.email_subscriptions enable row level security;
alter table private.email_action_tokens enable row level security;
alter table private.email_delivery_events enable row level security;
alter table private.audit_log enable row level security;
alter table analytics.events enable row level security;

-- The service role: everything in `private` and `jobs`; append and read on the
-- two logs, which nothing rewrites — retention runs as the owner from cron.
grant select, insert, update, delete on jobs.outbox, jobs.notification_jobs, jobs.cron_leases to service_role;
grant select, insert, update, delete on
  private.push_devices, private.email_contacts, private.email_subscriptions,
  private.email_action_tokens, private.email_delivery_events
  to service_role;
grant select, insert on private.audit_log to service_role;
grant select, insert on analytics.events to service_role;
grant usage on all sequences in schema jobs to service_role;
alter default privileges in schema jobs grant select, insert, update, delete on tables to service_role;
alter default privileges in schema private grant select, insert, update, delete on tables to service_role;
alter default privileges in schema jobs grant usage on sequences to service_role;

-- Functions: both revokes on each (see 0002 for why), plus the one grant.
revoke all on function jobs.emit(text, text, uuid, jsonb) from public;
revoke all on function jobs.emit(text, text, uuid, jsonb) from anon, authenticated;
grant execute on function jobs.emit(text, text, uuid, jsonb) to service_role;
revoke all on function jobs.on_circle_created() from public;
revoke all on function jobs.on_circle_created() from anon, authenticated;
revoke all on function jobs.on_member_changed() from public;
revoke all on function jobs.on_member_changed() from anon, authenticated;
revoke all on function jobs.on_response_changed() from public;
revoke all on function jobs.on_response_changed() from anon, authenticated;
revoke all on function jobs.on_attendance_updated() from public;
revoke all on function jobs.on_attendance_updated() from anon, authenticated;
revoke all on function jobs.carries_content(jsonb) from public;
revoke all on function jobs.carries_content(jsonb) from anon, authenticated;
-- A check constraint is evaluated as the writer (0002 learnt this for
-- `canonical_display_name`); the service role writes all three tables.
grant execute on function jobs.carries_content(jsonb) to service_role;
revoke all on function planning.event_for(text, text) from public;
revoke all on function planning.event_for(text, text) from anon, authenticated;

-- nudge_states: own rows, and only the columns a client has business writing.
alter table public.nudge_states enable row level security;

create policy nudge_states_select_own on public.nudge_states
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A plan-bound moment may be recorded only against a plan in one's own
-- circles; a nudge is never about somebody else's plan. Which moments are
-- plan-bound is the table's constraint, not this policy's.
create policy nudge_states_insert_own on public.nudge_states
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (plan_id is null or exists (
      select 1 from public.plans p where p.id = plan_id and public.auth_is_member(p.circle_id)
    ))
  );

create policy nudge_states_update_own on public.nudge_states
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.nudge_states from anon, authenticated;
grant select on public.nudge_states to authenticated;
grant insert (user_id, moment, plan_id, answer, snoozed_until) on public.nudge_states to authenticated;
grant update (answer, snoozed_until) on public.nudge_states to authenticated;
