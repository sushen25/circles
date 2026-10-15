-- ---------------------------------------------------------------------------
-- Was the plan handed on after this deadline passed? (SUS-96)
--
-- The dispatcher drains before it sweeps. An organiser who hands a plan over
-- after its deadline but before the sweep has announced it is therefore told
-- first, by the hand-off's own `replies_closed`; the sweep's event is drained a
-- tick later, and by day the letter it would write goes to the same person, who
-- has already read the first. Overnight both are held and the second takes the
-- place of the first (`dispatch_supersede_closing`), which is why only a
-- by-day dispatcher shows it.
--
-- `replies_closed` is exempt from the send-time dedupe on purpose (an extended
-- deadline's letter must go), so the drain declines the sweep's letter instead,
-- when this says yes. It says yes only when the hand-off's own letter exists:
--
--   * a `planning.organiser_changed` the drain **finished with**, not gave up
--     on (`last_error` is null: five failed attempts also set `processed_at`,
--     and write nothing); and
--   * a `replies_closed` job for the plan written at or after `p_since`.
--
-- The second is what tells a hand-off that ran with the deadline behind it
-- from one that ran just before it and wrote `options_ready`, without
-- comparing a timestamp from the database with the dispatcher's own clock. A
-- hand-off before an extension (or the extended deadline itself) has no such
-- job after the *new* deadline, so the extended deadline's letter is still owed.
--
-- The follow-up sweep has a rule of the same intent in `dispatch_timed_work`:
-- not after a hand-off since the first letter.
--
-- Service role only. Reads the outbox and the jobs, nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_handed_off_since(p_plan_id uuid, p_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from jobs.outbox h
    where h.event_name = 'planning.organiser_changed'
      and h.aggregate_id = p_plan_id
      and h.processed_at is not null
      and h.processed_at >= p_since
      and h.last_error is null
  )
  and exists (
    select 1 from jobs.notification_jobs j
    where j.plan_id = p_plan_id
      and j.kind = 'replies_closed'
      and j.created_at >= p_since
  );
$$;

comment on function public.dispatch_handed_off_since(uuid, timestamptz) is
  'True when a hand-off the drain finished with at or after p_since has already written the new organiser a replies_closed letter (written at or after p_since). Service role only (SUS-96).';

revoke all on function public.dispatch_handed_off_since(uuid, timestamptz) from public;
revoke all on function public.dispatch_handed_off_since(uuid, timestamptz) from anon, authenticated;
grant execute on function public.dispatch_handed_off_since(uuid, timestamptz) to service_role;
