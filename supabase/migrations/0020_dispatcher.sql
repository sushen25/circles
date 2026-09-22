-- ---------------------------------------------------------------------------
-- 0020 — the dispatcher's half of the database (S1-20).
--
-- `process-scheduled-jobs` is the one background worker (ADR 0003). It reads
-- and writes the `jobs` schema, takes the lease in `jobs.cron_leases`, runs a
-- plan transition and creates the organiser's email contact — and it can reach
-- none of that directly, because an Edge Function reaches the database through
-- PostgREST and `[api] schemas` is `["public"]`. So every step it takes is a
-- `public.dispatch_*` function here, granted to the service role and to
-- nobody else.
--
-- Wrappers rather than opening the `jobs` schema to PostgREST, for the reason
-- 0006 gave when it revoked those schemas from every client role: a grant made
-- by mistake later still meets an empty policy set, and `070_communication_jobs`
-- walks the catalogue to prove it. Exposing `jobs` would make that test's
-- promise depend on a configuration file.
--
-- Nothing new is stored. The one function that writes a row a person owns is
-- `public.dispatch_organiser_contact`, which turns the organiser's confirmed
-- auth address into an ordinary `private.email_contacts` row so that organiser
-- email can be addressed, suppressed and bounced like any other (ADR 0027).
--
-- A new migration rather than a regenerated `0019`, because `0019` has
-- shipped; `MIGRATION` in `scripts/gen-sql-functions.mjs` now points here.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/jobs/run_retention.sql
-- ---------------------------------------------------------------------------
-- Retention (§8.5, ADR 0005).
--
-- One function, one rule per statement, each returning what it deleted so the
-- run can be read afterwards. Runs as the owner: the service role holds no
-- delete on the two logs and cannot touch `auth.users`, and that is right —
-- an Edge Function with the power to purge is a bigger surface than a cron
-- job in the database.
--
-- Things this deliberately does not delete:
--   * suppressed contacts — the suppression list is the promise not to send
--     again, and it has to outlive the address it is about;
--   * analytics events — the record;
--   * plans, responses, confirmations — the product's history.
-- ---------------------------------------------------------------------------

create or replace function jobs.run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_outbox integer;
  n_jobs integer;
  n_delivery integer;
  n_invites integer;
  n_tokens integer;
  n_pending_contacts integer;
  n_plan_contacts integer;
  n_summaries integer;
  n_summaries_purged integer;
  n_windows_aged integer;
  n_windows_gone integer;
  n_anonymous integer;
  n_requests integer;
  n_counters integer;
  n_audit integer;
  result jsonb;
begin
  -- Outbox and pipeline bookkeeping: 30 days. An unprocessed outbox row is
  -- never deleted, however old — the health job reports it instead.
  delete from jobs.outbox where processed_at < now() - interval '30 days';
  get diagnostics n_outbox = row_count;

  delete from jobs.notification_jobs where created_at < now() - interval '30 days';
  get diagnostics n_jobs = row_count;

  delete from private.email_delivery_events where recorded_at < now() - interval '30 days';
  get diagnostics n_delivery = row_count;

  -- Revoked invite hashes: 30 days.
  delete from public.circle_invites where revoked_at < now() - interval '30 days';
  get diagnostics n_invites = row_count;

  -- Expired or used tokens: 7 days after they stopped being usable.
  delete from private.email_action_tokens
  where expires_at < now() - interval '7 days'
     or used_at < now() - interval '7 days';
  get diagnostics n_tokens = row_count;

  -- Unverified contacts: 7 days. Somebody typed an address and never clicked
  -- the link; the address does not stay — unless a link they could still
  -- click exists, because a contact that asked for a fresh link yesterday is
  -- not one that gave up a week ago, and the cascade would take the link.
  --
  -- Or unless the link has not been *made* yet. Since ADR 0020 the token is
  -- minted when the email is sent, so a contact that asked a minute ago holds
  -- a queued `verify_email` and no token at all. That is fine for a new
  -- contact — `created_at` is a minute old — and wrong for a resend, because
  -- the upsert keeps the original `created_at`: somebody who asked eight days
  -- ago, let the link lapse and asked again would have had this run delete the
  -- contact, the queued email and the consent in the gap before the dispatcher
  -- drained it, having just been told to check their email.
  --
  -- It cannot keep a contact for ever: the `notification_jobs` rule above runs
  -- first in this same function and takes any job older than thirty days, so a
  -- job that never drains stops sparing its contact a month later.
  delete from private.email_contacts c
  where c.status = 'pending'
    and c.created_at < now() - interval '7 days'
    and not exists (
      select 1 from private.email_action_tokens t
      where t.contact_id = c.id and t.used_at is null and t.expires_at > now()
    )
    and not exists (
      select 1 from jobs.notification_jobs j
      where j.contact_id = c.id and j.kind = 'verify_email' and j.status = 'scheduled'
    );
  get diagnostics n_pending_contacts = row_count;

  -- Verified plan-only contacts: 30 days after every plan they were subscribed
  -- to has finished. "Plan-only" used to mean "verified and not suppressed",
  -- because every contact in the MVP was one somebody gave for a plan (spec
  -- §3: no marketing consent). Two of them are not, and each would otherwise
  -- be deleted along with the letters still hanging off it — the fkey is
  -- `on delete cascade`, so the row going takes the queued mail silently.
  --
  --   * **An identity's own confirmed auth address** (ADR 0027, S1-20). It is
  --     not a plan's: it is how the organiser is written to at all, for as
  --     long as the identity exists, and it holds no subscription by design.
  --     Deleted with the user by the cascade, which is the right lifetime.
  --     Thirty days after an organiser's first plan, this rule was taking it —
  --     and with it the "did it happen?" letter due at nine the next morning.
  --   * **Any contact with a job still waiting.** Independent of whose address
  --     it is: a scheduled row is a message somebody is owed, and deleting the
  --     contact under it is the one failure nobody would ever see. The
  --     `notification_jobs` rule above still takes jobs older than thirty
  --     days, so this cannot keep a contact for ever.
  delete from private.email_contacts c
  where c.status = 'verified'
    and not exists (
      select 1
      from private.email_subscriptions s
      join public.plans p on p.id = s.plan_id
      where s.contact_id = c.id
        and s.status = 'active'
        and (p.state not in ('completed', 'cancelled', 'expired')
             or p.updated_at > now() - interval '30 days')
    )
    and not exists (
      select 1 from auth.users u
      where u.id = c.user_id
        and u.email_confirmed_at is not null
        and c.email_hash = extensions.digest(lower(btrim(u.email)), 'sha256')
    )
    and not exists (
      select 1 from jobs.notification_jobs j
      where j.contact_id = c.id and j.status = 'scheduled'
    )
    and c.verified_at < now() - interval '30 days';
  get diagnostics n_plan_contacts = row_count;

  -- Willing windows, rule one (ADR 0005): 12 months, for members of active
  -- circles — after the summary is written, from everything still stored,
  -- so that what the member usually offers survives the windows going.
  -- Dropped first: two runs in one transaction (a test, a retry) would
  -- otherwise meet their own table.
  perform set_config('client_min_messages', 'warning', true);
  drop table if exists aged_responses;
  create temporary table aged_responses on commit drop as
    select r.id as response_id, p.circle_id, r.user_id
    from public.plan_responses r
    join public.plans p on p.id = r.plan_id
    join public.circles c on c.id = p.circle_id
    join public.circle_members m on m.circle_id = c.id and m.user_id = r.user_id
    where r.submitted_at < now() - interval '12 months'
      and c.status = 'active'
      and m.status = 'active'
      and exists (select 1 from public.willing_windows w where w.response_id = r.id);

  -- Added to what is already summarised, never recomputed from what is left:
  -- the windows that went last time are in the stored counts and nowhere else.
  insert into public.member_dayparts (circle_id, user_id, summary, computed_at)
  select g.circle_id, g.user_id,
    jobs.daypart_summary(jobs.add_daypart_counts(
      coalesce((select d.summary -> 'counts' from public.member_dayparts d
                where d.circle_id = g.circle_id and d.user_id = g.user_id), '{}'::jsonb),
      jobs.daypart_counts(g.response_ids)
    )),
    now()
  from (
    select a.circle_id, a.user_id, array_agg(a.response_id) as response_ids
    from aged_responses a group by a.circle_id, a.user_id
  ) g
  on conflict (circle_id, user_id) do update
    set summary = excluded.summary, computed_at = excluded.computed_at;
  get diagnostics n_summaries = row_count;

  delete from public.willing_windows w
  using aged_responses a
  where w.response_id = a.response_id;
  get diagnostics n_windows_aged = row_count;

  -- Willing windows, rule two: 30 days after removal or archiving. No summary
  -- — a removed member's pre-fill is nobody's to keep — and the summary that
  -- was written while they were a member goes with the windows.
  delete from public.member_dayparts d
  using public.circle_members m, public.circles c
  where m.circle_id = d.circle_id and m.user_id = d.user_id
    and c.id = d.circle_id
    and (
      (m.status = 'removed' and m.updated_at < now() - interval '30 days')
      or (c.status = 'archived' and c.updated_at < now() - interval '30 days')
    );
  get diagnostics n_summaries_purged = row_count;

  delete from public.willing_windows w
  using public.plan_responses r, public.plans p, public.circles c, public.circle_members m
  where w.response_id = r.id
    and p.id = r.plan_id
    and c.id = p.circle_id
    and m.circle_id = c.id and m.user_id = r.user_id
    and (
      (m.status = 'removed' and m.updated_at < now() - interval '30 days')
      or (c.status = 'archived' and c.updated_at < now() - interval '30 days')
    );
  get diagnostics n_windows_gone = row_count;

  -- Abandoned anonymous identities: a guest session that never joined
  -- anything, 30 days on. The cascade takes the profile.
  delete from auth.users u
  where coalesce(u.is_anonymous, false)
    and u.created_at < now() - interval '30 days'
    and not exists (select 1 from public.circle_members m where m.user_id = u.id);
  get diagnostics n_anonymous = row_count;

  -- The Edge Function kit's own bookkeeping (S1-13). Both of these are written
  -- on every request and read only by the request after it, so without a rule
  -- they are the two tables in the schema that grow forever.
  --
  -- Seven days for a served request, which is a retry window with a great deal
  -- of room in it: a client that has not retried inside a week is a client that
  -- has moved on, and the mutations themselves are idempotent by their own state
  -- anyway. An *unfinished* one is kept, however old — it means a function died
  -- between claiming a key and answering, and that is worth being able to find.
  delete from jobs.idempotent_requests
  where status = 'done' and completed_at < now() - interval '7 days';
  get diagnostics n_requests = row_count;

  -- A counter outside its own window can never be read again: `take_rate_token`
  -- computes `window_start` from the clock and only ever touches the current
  -- one. A day's grace, so that nothing is deleted while it is still counting.
  delete from jobs.rate_counters where window_start < now() - interval '1 day';
  get diagnostics n_counters = row_count;

  -- Audit log: 12 months.
  delete from private.audit_log where occurred_at < now() - interval '12 months';
  get diagnostics n_audit = row_count;

  result := jsonb_build_object(
    'outbox', n_outbox,
    'notification_jobs', n_jobs,
    'delivery_events', n_delivery,
    'revoked_invites', n_invites,
    -- Not "tokens": the key would trip the no-content check that guards the
    -- audit log, and rightly — a count of links is what this is.
    'expired_action_links', n_tokens,
    'pending_contacts', n_pending_contacts,
    'plan_only_contacts', n_plan_contacts,
    'daypart_summaries', n_summaries,
    'daypart_summaries_purged', n_summaries_purged,
    'windows_aged', n_windows_aged,
    'windows_of_the_gone', n_windows_gone,
    'anonymous_identities', n_anonymous,
    'served_requests', n_requests,
    'rate_counters', n_counters,
    'audit_rows', n_audit
  );

  -- The run is itself a fact worth keeping for a year: counts only.
  insert into private.audit_log (action, resource_type, metadata)
  values ('retention.ran', 'account', result);

  return result;
end;
$$;

comment on function jobs.run_retention() is
  'The daily retention rules of §8.5 and ADR 0005, one statement each; returns what each deleted. Runs as the owner from pg_cron.';

revoke all on function jobs.run_retention() from public;
revoke all on function jobs.run_retention() from anon, authenticated;
revoke all on function jobs.run_retention() from service_role;

-- supabase/sql/functions/public/dispatch_begin.sql
-- ---------------------------------------------------------------------------
-- The dispatcher's lease, reachable.
--
-- `jobs.acquire_lease` is executable by the service role and lives in `jobs`,
-- which PostgREST does not expose (`[api] schemas = ["public"]`). An Edge
-- Function reaches a database function through PostgREST or not at all, so the
-- three things `process-scheduled-jobs` does to the `jobs` schema — take the
-- lease, give it back, read and write the queues — each need a wrapper here.
--
-- The name and the TTL are written here rather than passed in. A caller that
-- could choose the lease name could run two dispatchers side by side by
-- choosing two, which is the one thing the lease exists to prevent.
--
-- **Ninety seconds, which is longer than the run's own budget of fifty.** The
-- first version matched the 55-second `pg_net` timeout, on the reasoning that
-- a run killed by that timeout should not keep the lease. That is the wrong
-- way round: `pg_net` timing out closes the HTTP call and the function keeps
-- running, so a lease that lapses at 55 seconds lapses *under* a dispatcher
-- that is still sending — and the next tick then draws the same jobs, because
-- `for update skip locked` holds only for the statement that took them
-- (review round 2). The cost of the longer lease is that a genuinely crashed
-- run blocks one further tick, which is a minute of nothing rather than a
-- second copy of somebody's email.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_begin(p_holder text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select jobs.acquire_lease('process_scheduled_jobs', interval '90 seconds', p_holder);
$$;

comment on function public.dispatch_begin(text) is
  'Takes the process_scheduled_jobs lease for 55 seconds. False while another run holds it, which means "do nothing this tick". Service role only (architecture §9.3).';

revoke all on function public.dispatch_begin(text) from public;
revoke all on function public.dispatch_begin(text) from anon, authenticated;
grant execute on function public.dispatch_begin(text) to service_role;

-- supabase/sql/functions/public/dispatch_cancel_pending.sql
-- ---------------------------------------------------------------------------
-- The evening is off, so the letters about it stop.
--
-- A confirmation schedules two messages into the future — the reminder two
-- hours before, and "did it happen?" the next morning — and cancelling or
-- rescheduling the meetup has to take them back. They are `scheduled` rows
-- with a `scheduled_for` days away; nothing else would ever look at them
-- again, and the first anyone would know is a reminder for a Thursday that was
-- called off on Tuesday.
--
-- Found by plan and revision rather than by confirmation id, because a job
-- does not carry one: a revision has at most one active confirmation (§8.2),
-- so (plan, revision) names it. A reopen bumps the revision, which is why the
-- caller passes the revision the superseded confirmation was on and not the
-- one the plan is on now.
--
-- `locked_in` is in the list for a case that is easy to miss: a transient
-- provider failure leaves it `scheduled` with a backoff of up to half an hour,
-- and a reopen inside that half hour would otherwise send "locked in" for an
-- evening that is off, followed by a second "locked in" for the new one.
--
-- `skipped`, not `failed`: nothing went wrong. The code says what happened.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_cancel_pending(p_plan_id uuid, p_revision integer)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with cancelled as (
    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'superseded', updated_at = now()
    where j.plan_id = p_plan_id
      and j.plan_revision = p_revision
      and j.status = 'scheduled'
      and j.kind in ('locked_in', 'reminder', 'did_it_happen', 'did_it_happen_participant')
    returning 1
  )
  select count(*)::integer from cancelled;
$$;

comment on function public.dispatch_cancel_pending(uuid, integer) is
  'Skips the still-scheduled reminder and outcome jobs for one plan revision, when its confirmation is cancelled or superseded. Service role only (S1-20).';

revoke all on function public.dispatch_cancel_pending(uuid, integer) from public;
revoke all on function public.dispatch_cancel_pending(uuid, integer) from anon, authenticated;
grant execute on function public.dispatch_cancel_pending(uuid, integer) to service_role;

-- supabase/sql/functions/public/dispatch_claim_due.sql
-- ---------------------------------------------------------------------------
-- The email jobs that are due, with the one address each is for.
--
-- Everything a send needs and nothing it does not. Three of the fields are
-- here because S1-18 found that the job alone is not enough to decide whether
-- to send it:
--
--   * `contact_status` — a suppression that lands after the job was written
--     leaves the job `scheduled`. "Permanent failure → skipped" (spec §9) is
--     evaluated when you send, not when the job was made.
--   * `subscribed` — and so is the consent. A `reminder` is written the moment
--     a meetup is confirmed and sits there for days; "Stop emails for this
--     meetup" withdraws the subscription and touches no job, so without this
--     the stop link would stop nothing that was already queued. It is
--     `private.email_recipients_for`, which is the one place the join is
--     written (S1-18), asked again at the moment of sending.
--   * `plan_state` — a verification queued while a plan was live is still
--     `scheduled` after the plan is cancelled, and sending it is a letter
--     about a meetup that is over.
--   * `superseded` — "one copy per event" is the sender's job, not the
--     writer's. One address can be held by two contacts since 0009: two
--     siblings subscribed to the same decided plan, or a guest who joined
--     twice, produce two jobs for one mailbox. The flag marks a job whose
--     letter has **already gone** to that address.
--
--     Only `sent`, and that is the whole correction. It used to mark a job
--     whose sibling was merely `scheduled` and sorted earlier — which suppressed
--     the eligible copy when the earlier one turned out not to be: the first
--     was skipped for having left the circle, the second was skipped as a
--     duplicate of it, and the mailbox got nothing at all (review round 3).
--     A copy cannot be a duplicate of one that was never sent, so the
--     within-a-batch half of the rule belongs after eligibility, in the sender,
--     where it is keyed on the address a letter actually went to.
--
-- The dedupe is by `(kind, plan, revision, address)` and is applied only to
-- the kinds whose occurrence is *determined* by the plan revision —
-- `locked_in`, `cancelled`, `reminder`, `did_it_happen_participant`, and the
-- organiser kinds, which have one contact anyway. `changed` and `verify_email`
-- are excluded on purpose: both can legitimately occur twice in one revision
-- (a second material change, a second verification request), they are keyed by
-- change id and verification id for exactly that reason, and deduping them by
-- address is how nobody gets told the venue moved. `about_time` (Slice 2,
-- SUS-52) is excluded for a third reason: it belongs to a circle and has no
-- plan at all, so every one of them matches every other on
-- `plan_id is not distinct from null` and an address would receive exactly
-- one cadence nudge, ever.
--
-- Push is not claimed here. Slice 1 writes no push job — a kind whose only
-- channel is push finds no device and produces no recipient — and Slice 3
-- (SUS-59) adds the Expo half with its own receipts.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_claim_due(p_limit integer default 50)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with due as (
    select j.*
    from jobs.notification_jobs j
    where j.status = 'scheduled'
      and j.channel = 'email'
      and j.scheduled_for <= now()
    order by j.scheduled_for, j.created_at, j.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'kind', j.kind,
    'contact_id', j.contact_id,
    'user_id', c.user_id,
    'plan_id', j.plan_id,
    'plan_revision', j.plan_revision,
    'idempotency_key', j.idempotency_key,
    'attempt_count', j.attempt_count,
    'email', c.email_normalized,
    'contact_status', c.status,
    'subscribed', exists (
      select 1 from private.email_recipients_for(j.plan_id) r where r.contact_id = j.contact_id
    ),
    -- `email_recipients_for` answers one question with three conditions in it,
    -- and the sender has to tell them apart: somebody who was removed from the
    -- circle withdrew nothing, and recording `subscription_withdrawn` against
    -- them tells whoever reads `last_error` the wrong story (review round 2).
    'member_active', exists (
      select 1 from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = c.user_id and m.status = 'active'
    ),
    'plan_state', p.state,
    'plan_short_code', p.short_code,
    'plan_current_revision', p.revision,
    'circle_id', p.circle_id,
    'circle_name', cir.name,
    'superseded', j.kind not in ('changed', 'verify_email', 'about_time') and exists (
      select 1
      from jobs.notification_jobs o
      join private.email_contacts oc on oc.id = o.contact_id
      where o.id <> j.id
        and o.kind = j.kind
        and o.plan_id is not distinct from j.plan_id
        and o.plan_revision is not distinct from j.plan_revision
        and oc.email_hash = c.email_hash
        and o.status = 'sent'
    )
  ) order by j.scheduled_for, j.created_at, j.id), '[]'::jsonb)
  from due j
  join private.email_contacts c on c.id = j.contact_id
  left join public.plans p on p.id = j.plan_id
  left join public.circles cir on cir.id = p.circle_id;
$$;

comment on function public.dispatch_claim_due(integer) is
  'The due email jobs, each with its address, the contact''s status now, the plan''s state now, and whether an earlier job already covers this address for this event. Service role only (S1-20).';

revoke all on function public.dispatch_claim_due(integer) from public;
revoke all on function public.dispatch_claim_due(integer) from anon, authenticated;
grant execute on function public.dispatch_claim_due(integer) to service_role;

-- supabase/sql/functions/public/dispatch_claim_events.sql
-- ---------------------------------------------------------------------------
-- The outbox drain's read (ADR 0003).
--
-- **By `seq`, not `occurred_at`.** `occurred_at` defaults to `now()`, which is
-- the transaction's start, so every event written by one transaction carries
-- the same value and their order is whatever the sort happens to give. `seq`
-- is an identity column and cannot tie (S1-11).
--
-- `for update skip locked` belongs to the pattern even though the lease
-- already serialises runs: the lease is a row somebody has to honour, and this
-- is the database refusing. The lock lasts for this statement's transaction,
-- which is one PostgREST request — long enough to keep two runs off the same
-- row, not long enough to hold a row while it is being handled. What actually
-- makes handling safe to repeat is the idempotency key on every job it
-- produces.
--
-- A row is returned with its `attempts`, because the dispatcher decides
-- whether a failure has been retried enough, and one JSON document rather than
-- a set, because that is what a PostgREST `rpc` hands back in one piece.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_claim_events(p_limit integer default 200)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.seq), '[]'::jsonb)
  from (
    select o.id, o.seq, o.event_name, o.aggregate_type, o.aggregate_id, o.payload, o.attempts
    from jobs.outbox o
    where o.processed_at is null
    order by o.seq
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  ) e;
$$;

comment on function public.dispatch_claim_events(integer) is
  'The next unprocessed outbox events in seq order, skipping any another run holds. Service role only (S1-20).';

revoke all on function public.dispatch_claim_events(integer) from public;
revoke all on function public.dispatch_claim_events(integer) from anon, authenticated;
grant execute on function public.dispatch_claim_events(integer) to service_role;

-- supabase/sql/functions/public/dispatch_context.sql
-- ---------------------------------------------------------------------------
-- Everything the dispatcher needs to decide who hears about a plan, read once.
--
-- The rules themselves are `packages/domain/communication`'s and stay there
-- (non-negotiable 2): `recipientsFor` is a pure function of state, which is
-- what makes "a reminder to somebody who said they cannot come" testable
-- without Resend. This is the state. It is one statement for the reason
-- `public.engine_input` is one statement — an eligibility decision taken from
-- a roster read at one moment and answers read at another is a decision about
-- a circle that never existed.
--
-- What it deliberately does **not** carry: the initiator of a quiet ask (read
-- `private.plan_initiators` only where a kind needs it, and never into a job),
-- any email address (ids only; the address is read once, by the sender, from
-- `dispatch_claim_due`), and anyone's availability windows (eligibility needs
-- statuses, never times).
--
-- Names and titles *are* here, because the templates render them. This value
-- goes to the service role and to nowhere else: never to the outbox, never to
-- `analytics`, never to a log line (non-negotiable 8).
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_context(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'circle', to_jsonb(c) - 'created_at' - 'updated_at' - 'creation_key',
    'plan', to_jsonb(p) - 'created_at' - 'updated_at',
    'organiser_name', (
      select m.display_name_snapshot from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = p.organiser_user_id
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', m.circle_id, 'user_id', m.user_id, 'display_name', m.display_name_snapshot,
        'role', m.role, 'status', m.status, 'joined_at', m.joined_at,
        'muted_quiet_asks', m.muted_quiet_asks, 'muted_all', m.muted_all,
        'time_zone', coalesce(pr.time_zone, c.time_zone),
        'is_permanent', coalesce(pr.is_permanent, false)
      ) order by m.joined_at, m.user_id)
      from public.circle_members m
      left join public.profiles pr on pr.user_id = m.user_id
      where m.circle_id = p.circle_id
    ), '[]'::jsonb),
    'participant_ids', coalesce((
      select jsonb_agg(pp.user_id order by pp.user_id) from public.plan_participants pp
      where pp.plan_id = p.id and pp.revision = p.revision
    ), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', r.plan_id, 'revision', r.revision, 'user_id', r.user_id, 'status', r.status
      ) order by r.user_id)
      from public.plan_responses r
      where r.plan_id = p.id and r.revision = p.revision
    ), '[]'::jsonb),
    -- The live confirmation for the revision this plan is on, and the one a
    -- reopen or a cancellation just superseded. `changed` needs the second:
    -- "the time we had is off" is a sentence about a start that is no longer
    -- on the plan.
    'confirmation', (
      select to_jsonb(mc) - 'created_at' - 'updated_at'
      from public.meetup_confirmations mc
      where mc.plan_id = p.id and mc.status = 'active'
      order by mc.confirmed_at desc limit 1
    ),
    'superseded_confirmation', (
      select to_jsonb(mc) - 'created_at' - 'updated_at'
      from public.meetup_confirmations mc
      where mc.plan_id = p.id and mc.status <> 'active'
      order by mc.superseded_at desc nulls last, mc.confirmed_at desc limit 1
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', a.confirmation_id, 'user_id', a.user_id, 'status', a.status
      ) order by a.user_id)
      from public.attendance a
      join public.meetup_confirmations mc on mc.id = a.confirmation_id
      where mc.plan_id = p.id
    ), '[]'::jsonb),
    -- Verified contact, active subscription, active member — the join that
    -- `hasPlanEmailSubscription` actually means, written once in S1-18 and not
    -- worked out again here.
    'email_recipients', coalesce((
      select jsonb_agg(jsonb_build_object('contact_id', e.contact_id, 'user_id', e.user_id))
      from private.email_recipients_for(p.id) e
    ), '[]'::jsonb),
    'push_user_ids', coalesce((
      select jsonb_agg(distinct d.user_id) from private.push_devices d
      join public.circle_members m on m.user_id = d.user_id and m.circle_id = p.circle_id
      where d.enabled
    ), '[]'::jsonb),
    -- The top eligible option of the set that matches where the plan is now,
    -- for `options_ready`. A stale set is no answer: the organiser would be
    -- told about a time somebody has since said they cannot make.
    'best_candidate', (
      select jsonb_build_object(
        'starts_at', cd.starts_at, 'available_count', cardinality(cd.available_user_ids))
      from public.candidate_sets cs
      join public.candidates cd on cd.candidate_set_id = cs.id
      where cs.plan_id = p.id and cs.revision = p.revision and cs.input_version = p.input_version
        and not cd.is_near_miss
      order by cd.rank limit 1
    ),
    -- "At most one deadline reminder per member per plan" spans revisions, so
    -- it cannot come from the idempotency key: an edit bumps the revision and
    -- the key alone would re-remind everybody. `EligibilityContext.alreadySent`.
    'already_reminded', coalesce((
      select jsonb_agg(distinct coalesce(j.user_id, ec.user_id))
      from jobs.notification_jobs j
      left join private.email_contacts ec on ec.id = j.contact_id
      where j.plan_id = p.id and j.kind = 'deadline_approaching'
    ), '[]'::jsonb)
  )
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.id = p_plan_id;
$$;

comment on function public.dispatch_context(uuid) is
  'One plan''s circle, roster, participants, answers, confirmations, attendance, email recipients and top candidate, read together, for the dispatcher''s eligibility rules. Ids and display names; never an address, a token or an availability window. Service role only (S1-20).';

revoke all on function public.dispatch_context(uuid) from public;
revoke all on function public.dispatch_context(uuid) from anon, authenticated;
grant execute on function public.dispatch_context(uuid) to service_role;

-- supabase/sql/functions/public/dispatch_end.sql
-- The other half of `public.dispatch_begin`. `jobs.release_lease` releases only
-- for the holder that took it, so a run that overran and was superseded cannot
-- hand the next one's lease away.

create or replace function public.dispatch_end(p_holder text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select jobs.release_lease('process_scheduled_jobs', p_holder);
$$;

comment on function public.dispatch_end(text) is
  'Releases the process_scheduled_jobs lease if this holder still has it. Service role only.';

revoke all on function public.dispatch_end(text) from public;
revoke all on function public.dispatch_end(text) from anon, authenticated;
grant execute on function public.dispatch_end(text) to service_role;

-- supabase/sql/functions/public/dispatch_enqueue.sql
-- ---------------------------------------------------------------------------
-- The jobs one event turned into, written in one statement.
--
-- `on conflict (idempotency_key) do nothing` is the whole of "delivery is
-- idempotent per recipient, plan revision, kind and occurrence" (spec §5.8).
-- A drain that crashes between enqueueing and marking the event processed runs
-- again and writes nothing new; a duplicate key is "already scheduled", not an
-- error (S1-11).
--
-- The count returned is of rows actually inserted, so a drain can say in its
-- log how much of what it computed was new — a number, not a recipient.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_enqueue(p_jobs jsonb)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with wanted as (
    select * from jsonb_to_recordset(coalesce(p_jobs, '[]'::jsonb)) as j (
      channel text,
      kind text,
      user_id uuid,
      contact_id uuid,
      plan_id uuid,
      plan_revision integer,
      scheduled_for timestamptz,
      idempotency_key text
    )
  ), written as (
    insert into jobs.notification_jobs (
      channel, kind, user_id, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
    )
    select w.channel, w.kind, w.user_id, w.contact_id, w.plan_id, w.plan_revision,
      w.scheduled_for, w.idempotency_key
    from wanted w
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*)::integer from written;
$$;

comment on function public.dispatch_enqueue(jsonb) is
  'Inserts notification jobs, ignoring any whose idempotency key already exists, and answers how many were new. Service role only (S1-20).';

revoke all on function public.dispatch_enqueue(jsonb) from public;
revoke all on function public.dispatch_enqueue(jsonb) from anon, authenticated;
grant execute on function public.dispatch_enqueue(jsonb) to service_role;

-- supabase/sql/functions/public/dispatch_event_result.sql
-- ---------------------------------------------------------------------------
-- What became of one outbox event.
--
-- `p_error` null is success: `processed_at` is stamped and the row is never
-- read again. A code — and it must be a code, `outbox_last_error_is_a_code`
-- refuses a sentence and the reason is that an exception's text is where
-- addresses and notes turn up (non-negotiable 8) — counts an attempt and
-- leaves the row unprocessed so the next tick tries again.
--
-- After five attempts the row is stamped processed **with the error still on
-- it**. An event that has failed five times is not going to succeed on the
-- sixth, and an outbox that never drains is one the health summary reports as
-- stuck for ever. The code stays so that the row says why it was given up on.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_event_result(p_id uuid, p_error text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update jobs.outbox o set
    attempts = o.attempts + (case when p_error is null then 0 else 1 end),
    last_error = p_error,
    processed_at = case
      when p_error is null then now()
      when o.attempts + 1 >= 5 then now()
      else null
    end
  where o.id = p_id;
$$;

comment on function public.dispatch_event_result(uuid, text) is
  'Marks an outbox event processed, or counts a failed attempt against it and gives up at five. The error is a classified code, never an exception text. Service role only.';

revoke all on function public.dispatch_event_result(uuid, text) from public;
revoke all on function public.dispatch_event_result(uuid, text) from anon, authenticated;
grant execute on function public.dispatch_event_result(uuid, text) to service_role;

-- supabase/sql/functions/public/dispatch_health.sql
-- ---------------------------------------------------------------------------
-- What the founder needs to know once a day, as counts.
--
-- Four numbers, chosen because each one is something no screen would ever show
-- and nobody would otherwise look for (S4-06 builds the diagnostics screen on
-- the same query):
--
--   * jobs that gave up in the last 24 hours;
--   * outbox rows older than ten minutes that are still unprocessed — the one
--     thing retention never deletes, however old, precisely so that this can
--     report them (ADR 0014);
--   * addresses suppressed in the last 24 hours, which is a bounce rate by
--     another name;
--   * plans still in `ready` more than 48 hours past their deadline, which is
--     an organiser who was told the replies closed and did nothing.
--
-- Counts and two timestamps, and nothing else: this value goes into an email
-- and a log line, so a plan title or an address in it would be the leak
-- non-negotiable 8 names. The lease times come from `jobs.cron_leases`, which
-- is where "did the dispatcher run at all" is recorded (S1-12).
--
-- **Claiming is what makes it daily.** The dispatcher runs every minute and
-- has no memory between runs, so "once per day at 08:00 UTC" has to be a fact
-- in the database rather than a variable in a process. The claim is a row in
-- `private.audit_log` — a fact worth keeping for a year, counts only, exactly
-- as `jobs.run_retention` records its own runs — and the function answers null
-- when today's has already been made. `p_claim => false` reads the same
-- numbers without claiming, which is what a diagnostics screen and a test want.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_health(p_claim boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  summary jsonb;
begin
  if p_claim then
    -- The report is due from 08:00 UTC and is made once. A run that is late
    -- because nothing invoked the dispatcher at eight still makes it.
    if now() < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '8 hours'
      or exists (
        select 1 from private.audit_log a
        where a.action = 'health.reported'
          and a.occurred_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
      )
    then
      return null;
    end if;
  end if;

  select jsonb_build_object(
    'failed_jobs_24h', (
      select count(*) from jobs.notification_jobs j
      where j.status = 'failed' and j.updated_at >= now() - interval '24 hours'
    ),
    'stuck_outbox', (
      select count(*) from jobs.outbox o
      where o.processed_at is null and o.occurred_at < now() - interval '10 minutes'
    ),
    'suppressed_24h', (
      select count(*) from private.email_suppressions s
      where s.suppressed_at >= now() - interval '24 hours'
    ),
    'stuck_ready_plans', (
      select count(*) from public.plans p
      where p.state = 'ready' and p.response_deadline < now() - interval '48 hours'
    ),
    'dispatcher_last_finished_at', (
      select l.last_finished_at from jobs.cron_leases l where l.name = 'process_scheduled_jobs'
    ),
    'retention_last_finished_at', (
      select l.last_finished_at from jobs.cron_leases l where l.name = 'retention_daily'
    )
  ) into summary;

  if p_claim then
    insert into private.audit_log (action, resource_type, metadata)
    values ('health.reported', 'account', summary);
  end if;

  return summary;
end;
$$;

comment on function public.dispatch_health(boolean) is
  'The daily health summary as counts: failed jobs, stuck outbox rows, suppressions, plans stuck in ready, and when each scheduled job last finished. Claims the day''s report through private.audit_log and answers null when it is already made. No identifiers, no content. Service role only (S1-20).';

revoke all on function public.dispatch_health(boolean) from public;
revoke all on function public.dispatch_health(boolean) from anon, authenticated;
grant execute on function public.dispatch_health(boolean) to service_role;

-- supabase/sql/functions/public/dispatch_health_due.sql
-- ---------------------------------------------------------------------------
-- Whether today's health summary is still owed.
--
-- Split from `public.dispatch_health` so that the claim can be made **after**
-- the letter is out rather than before it. Claiming first meant a provider
-- having a bad morning took the whole day's report with it: the first run
-- after 08:00 UTC wrote the audit row, the send failed with a retryable code,
-- and the remaining fourteen hundred runs that day found the day already
-- claimed and reported nothing — at exactly the moment somebody would want to
-- know (review round 3).
--
-- Read-only, and cheap: two conditions on one row. The dispatcher asks it
-- every minute and does nothing further on a no.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_health_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select now() >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '8 hours'
    and not exists (
      select 1 from private.audit_log a
      where a.action = 'health.reported'
        and a.occurred_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );
$$;

comment on function public.dispatch_health_due() is
  'True when today''s health summary is due (from 08:00 UTC) and has not been claimed. Service role only (S1-20).';

revoke all on function public.dispatch_health_due() from public;
revoke all on function public.dispatch_health_due() from anon, authenticated;
grant execute on function public.dispatch_health_due() to service_role;

-- supabase/sql/functions/public/dispatch_job_result.sql
-- ---------------------------------------------------------------------------
-- What became of one notification job.
--
-- Four outcomes, and the difference between them is what happens next (spec
-- §9, architecture §13):
--
--   * `sent` — the provider took it. `provider_message_id` is how the delivery
--     webhook finds this row again, so it is stored in the same statement that
--     says the job was sent.
--   * `retry` — a transient failure. The row stays `scheduled` with a later
--     `scheduled_for`; the backoff (1, 5, 30 minutes) is the dispatcher's, and
--     what is written here is the instant it chose.
--   * `failed` — a transient failure that has run out of attempts, or a fault
--     of ours the provider will keep refusing.
--   * `skipped` — nothing went wrong and nothing should be sent: a suppressed
--     contact, a withdrawn subscription, a plan that is over, a second copy to
--     one address, a verification with nothing left to verify.
--
-- `last_error` is a classified code in every case
-- (`notification_jobs_last_error_is_a_code`). The provider's own message is
-- never persisted: it quotes the recipient's address (S1-19).
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_job_result(
  p_id uuid,
  p_outcome text,
  p_error text default null,
  p_provider_message_id text default null,
  p_next_attempt_at timestamptz default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update jobs.notification_jobs j set
    status = case p_outcome when 'retry' then 'scheduled' else p_outcome end,
    attempt_count = j.attempt_count + 1,
    last_error = case p_outcome when 'sent' then null else p_error end,
    sent_at = case p_outcome when 'sent' then now() else null end,
    provider_message_id = case p_outcome when 'sent' then p_provider_message_id else j.provider_message_id end,
    scheduled_for = case p_outcome when 'retry' then coalesce(p_next_attempt_at, now()) else j.scheduled_for end,
    updated_at = now()
  where j.id = p_id
    and p_outcome in ('sent', 'retry', 'failed', 'skipped');
$$;

comment on function public.dispatch_job_result(uuid, text, text, text, timestamptz) is
  'Records the outcome of one send: sent with its provider message id, retry with the next attempt time, or failed/skipped with a classified code. Service role only (S1-20).';

revoke all on function public.dispatch_job_result(uuid, text, text, text, timestamptz) from public;
revoke all on function public.dispatch_job_result(uuid, text, text, text, timestamptz) from anon, authenticated;
grant execute on function public.dispatch_job_result(uuid, text, text, text, timestamptz) to service_role;

-- supabase/sql/functions/public/dispatch_organiser_contact.sql
-- ---------------------------------------------------------------------------
-- The organiser's auth email, as something that can be sent to.
--
-- Spec §5.8 sends the organiser kinds — options ready, replies closed, did it
-- happen, about time — to "the signed-in organiser" by email until they
-- install the app. `jobs.notification_jobs` cannot address a person: the email
-- channel takes a `contact_id` and no `user_id` (`notification_jobs_recipient`,
-- S1-11 round 5), and the delivery webhook suppresses by contact and by
-- address hash. An organiser with no contact row is an organiser the pipeline
-- has no way to write to, and no way to stop writing to after a bounce.
--
-- So the auth address becomes an ordinary contact, and the suppression
-- machinery covers organiser mail exactly as it covers plan-update mail
-- (ADR 0027).
--
-- **Verified, because auth already verified it.** `email_contacts.status`
-- records whether we have proof this identity controls this address. A
-- verification link is one proof; `auth.users.email_confirmed_at` — set by the
-- sign-in code the person typed back — is the same proof, obtained earlier.
-- An address with no `email_confirmed_at` is not one of those, and gets
-- nothing here.
--
-- **No subscription is created.** A subscription is consent to plan-update
-- email, scoped to one plan, and this is not that (privacy invariant: "plan
-- update email consent is scoped to one plan and is never marketing consent").
-- The organiser kinds carry `emailNeedsSubscription: false` in the domain's
-- table and need none.
--
-- **Suppressed stays suppressed**, and returns null: `apply_suppression` marks
-- a contact created for a tombstoned address on the way in, so a bounce that
-- happened to a plan-update letter also stops the organiser mail.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_organiser_contact(p_user_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  address text;
  contact private.email_contacts;
begin
  select lower(btrim(u.email)) into address
  from auth.users u
  where u.id = p_user_id
    and u.email_confirmed_at is not null
    and not coalesce(u.is_anonymous, false);

  -- A guest has no address of ours to write to, and a saved place that has not
  -- confirmed one has not proven it. Neither is a failure: it is an organiser
  -- with no reachable channel, which the domain already calls silence.
  if address is null or address !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return null;
  end if;

  select * into contact
  from private.email_contacts c
  where c.user_id = p_user_id
    and c.email_hash = extensions.digest(address, 'sha256');

  if not found then
    insert into private.email_contacts (user_id, email_normalized, status, verified_at)
    values (p_user_id, address, 'verified', now())
    returning * into contact;
  elsif contact.status = 'pending' then
    -- The same address, the same identity, and auth has confirmed it. Leaving
    -- it pending would silence the organiser because they once typed their own
    -- address into a plan's "email me updates" and never opened the letter.
    update private.email_contacts c
    set status = 'verified', verified_at = coalesce(c.verified_at, now()), updated_at = now()
    where c.id = contact.id
    returning * into contact;
  end if;

  if contact.status <> 'verified' then
    return null;
  end if;

  return contact.id;
end;
$$;

comment on function public.dispatch_organiser_contact(uuid) is
  'The email contact for an organiser''s confirmed auth address, created verified if absent. Null for a guest, an unconfirmed address or a suppressed one. Creates no subscription. Service role only (ADR 0027, S1-20).';

revoke all on function public.dispatch_organiser_contact(uuid) from public;
revoke all on function public.dispatch_organiser_contact(uuid) from anon, authenticated;
grant execute on function public.dispatch_organiser_contact(uuid) to service_role;

-- supabase/sql/functions/public/dispatch_timed_work.sql
-- ---------------------------------------------------------------------------
-- The work a clock creates, discovered from data rather than from a timer
-- (architecture §9.3).
--
-- Four things, every run, all of them queries:
--
-- 1. **A deadline that has passed.** Nothing emits `planning.deadline_passed`
--    — it is not a transition, and S1-11 left it for the sweep to raise. It is
--    emitted into the outbox rather than turned into a job here, so that the
--    one place events become notifications stays the drain. Once per
--    **deadline**, not once per plan: "give it one more day" (spec §5.7) moves
--    the deadline out and it passes again, and a marker keyed on the plan
--    would announce the second one to nobody. The outbox is still the marker,
--    which holds because a plan cannot outlive its own window by the thirty
--    days retention keeps events for (rule 2 below closes it long before).
--
-- 2. **A plan whose last possible start has gone.** Spec §9: "the plan stays
--    decidable until the last candidate start, then expires." The last start
--    is `public.plan_last_possible_start` — the same function the deadline
--    constraint uses, so the moment a plan stops being decidable and the
--    moment it may no longer be answered are one definition rather than two.
--    `expire` has no guards, so the actor is null: nobody did this, the window
--    closed.
--
-- 3. **A plan whose candidate set is stale.** After ADR 0018 every answer
--    recalculates in the request that caused it, and the cases with no request
--    to attach to are this function's: a member removed by a trigger, a
--    recalculation that lost its compare-and-set. Found by asking which plans
--    have no `candidate_sets` row at the version they are on (S1-16).
--
-- 4. **A deadline 24 hours out.** The plans, not the people: who is owed a
--    reminder is `recipientsFor('deadline_approaching')`'s answer and belongs
--    in the domain.
--
-- Each transition is attempted on its own and a refusal is counted rather than
-- thrown: a plan that was confirmed between the select and the update is a
-- race with a correct outcome, and losing it must not abandon the rest of the
-- batch.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_timed_work(p_limit integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  batch integer := greatest(1, least(coalesce(p_limit, 50), 200));
  target record;
  closed integer := 0;
  expired integer := 0;
  refused integer := 0;
begin
  for target in
    select p.id, p.circle_id, p.revision, p.response_deadline
    from public.plans p
    where p.state in ('collecting', 'ready')
      and p.response_deadline <= now()
      and not exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed'
          and o.aggregate_id = p.id
          and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
      )
    order by p.response_deadline
    limit batch
  loop
    perform jobs.emit('planning.deadline_passed', 'plan', target.id, jsonb_build_object(
      'plan_id', target.id, 'circle_id', target.circle_id, 'revision', target.revision,
      -- The marker, and the reason it is in the payload rather than implied by
      -- the row: spec §5.7's replies-closed screen offers "give it one more
      -- day", and an extended deadline passes a second time. Keyed on the plan
      -- alone, the second one is announced to nobody — and the organiser's only
      -- channel in Slice 1 is this letter. An instant is an allowed payload
      -- value: `jobs.carries_content` takes `[A-Za-z0-9_./:+-]` up to 40, and
      -- this is 32.
      --
      -- **To the microsecond, and rendered rather than cast.** The first
      -- version of this used `OF:00` and lost the fraction, so the comparison
      -- below — which is at full precision — never matched a marker it had
      -- written itself, and every plan with a fractional deadline was
      -- announced again every minute for as long as it stayed open. Almost
      -- every deadline is fractional: `defaultDeadline` is `now + 1h`. Found
      -- in review round 2, and it is why the round-2 test runs the sweep twice
      -- against one deadline rather than once against two.
      --
      -- Rendered in UTC with an explicit offset rather than left to jsonb's
      -- own cast, which would use the session's `TimeZone` and make the stored
      -- string depend on who called.
      'deadline', to_char(target.response_deadline at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')));
    closed := closed + 1;
  end loop;

  for target in
    select p.id
    from public.plans p
    where p.state in ('collecting', 'ready')
      and public.plan_last_possible_start(
            p.window_end, p.daily_end_local, p.duration_minutes, p.time_zone) <= now()
    order by p.window_end
    limit batch
  loop
    begin
      perform planning.transition_plan(target.id, 'expire', null);
      expired := expired + 1;
    exception when others then
      refused := refused + 1;
    end;
  end loop;

  return jsonb_build_object(
    'deadline_passed', closed,
    'expired', expired,
    'expire_refused', refused,
    'stale', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and not exists (
            select 1 from public.candidate_sets cs
            where cs.plan_id = p.id
              and cs.revision = p.revision
              and cs.input_version = p.input_version
          )
        order by p.updated_at
        limit least(batch, 20)
      ) x
    ), '[]'::jsonb),
    'approaching', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and p.response_deadline > now()
          and p.response_deadline <= now() + interval '24 hours'
        order by p.response_deadline
        limit batch
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.dispatch_timed_work(integer) is
  'One pass of the time-based work: emits planning.deadline_passed once per plan, expires plans whose last possible start has gone, and names the plans with a stale candidate set or a deadline within 24 hours. Service role only (S1-20).';

revoke all on function public.dispatch_timed_work(integer) from public;
revoke all on function public.dispatch_timed_work(integer) from anon, authenticated;
grant execute on function public.dispatch_timed_work(integer) to service_role;

-- END GENERATED: function definitions
