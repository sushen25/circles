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
-- email can be addressed, suppressed and bounced like any other (ADR 00XX).
--
-- A new migration rather than a regenerated `0019`, because `0019` has
-- shipped; `MIGRATION` in `scripts/gen-sql-functions.mjs` now points here.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

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
-- choosing two, which is the one thing the lease exists to prevent; and a TTL
-- longer than the minute between ticks would let a crashed run block every
-- later one until it lapsed. 55 seconds is the invocation budget in
-- `jobs.invoke_process_scheduled_jobs()` (`timeout_milliseconds := 55000`), so
-- a run that is killed by that timeout has already lost the lease when the
-- next tick asks for it.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_begin(p_holder text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select jobs.acquire_lease('process_scheduled_jobs', interval '55 seconds', p_holder);
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
      and j.kind in ('reminder', 'did_it_happen', 'did_it_happen_participant')
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
--   * `plan_state` — a verification queued while a plan was live is still
--     `scheduled` after the plan is cancelled, and sending it is a letter
--     about a meetup that is over.
--   * `superseded` — "one copy per event" is the sender's job, not the
--     writer's. One address can be held by two contacts since 0009: two
--     siblings subscribed to the same decided plan, or a guest who joined
--     twice, produce two jobs for one mailbox. The flag marks every copy after
--     the first.
--
-- The dedupe is by `(kind, plan, revision, address)` and is applied only to
-- the kinds whose occurrence is *determined* by the plan revision —
-- `locked_in`, `cancelled`, `reminder`, `did_it_happen_participant`, and the
-- organiser kinds, which have one contact anyway. `changed` and `verify_email`
-- are excluded on purpose: both can legitimately occur twice in one revision
-- (a second material change, a second verification request), they are keyed by
-- change id and verification id for exactly that reason, and deduping them by
-- address is how nobody gets told the venue moved.
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
    'plan_state', p.state,
    'plan_short_code', p.short_code,
    'plan_current_revision', p.revision,
    'circle_id', p.circle_id,
    'circle_name', cir.name,
    'superseded', j.kind not in ('changed', 'verify_email') and exists (
      select 1
      from jobs.notification_jobs o
      join private.email_contacts oc on oc.id = o.contact_id
      where o.id <> j.id
        and o.kind = j.kind
        and o.plan_id is not distinct from j.plan_id
        and o.plan_revision is not distinct from j.plan_revision
        and oc.email_hash = c.email_hash
        and (
          o.status = 'sent'
          or (o.status = 'scheduled' and (o.scheduled_for, o.created_at, o.id) < (j.scheduled_for, j.created_at, j.id))
        )
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
-- (ADR 00XX).
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
  'The email contact for an organiser''s confirmed auth address, created verified if absent. Null for a guest, an unconfirmed address or a suppressed one. Creates no subscription. Service role only (ADR 00XX, S1-20).';

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
--    one place events become notifications stays the drain. Once per plan: the
--    outbox is the marker, which holds because a plan cannot outlive its own
--    window by the thirty days retention keeps events for (rule 2 below closes
--    it long before).
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
    select p.id, p.circle_id, p.revision
    from public.plans p
    where p.state in ('collecting', 'ready')
      and p.response_deadline <= now()
      and not exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed' and o.aggregate_id = p.id
      )
    order by p.response_deadline
    limit batch
  loop
    perform jobs.emit('planning.deadline_passed', 'plan', target.id, jsonb_build_object(
      'plan_id', target.id, 'circle_id', target.circle_id, 'revision', target.revision));
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
