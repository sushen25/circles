-- 0061_the_sweep_defers_to_a_hand_off
--
-- SUS-96: `dispatch_handed_off_since`, so the drain can decline the sweep's
-- replies_closed when a hand-off already told the new organiser.

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/dispatch_handed_off_since.sql
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
-- deadline's letter must go), so the drain declines to write the sweep's
-- letter instead, when this says yes: a hand-off the drain **finished with**
-- at or after the deadline, which is a hand-off whose letter was written with
-- the deadline already behind it. A hand-off handled before the deadline (or
-- before it was extended) wrote an `options_ready`, and the letter for the
-- deadline that follows is still owed.
--
-- The follow-up sweep has the same rule in `dispatch_timed_work`: not after a
-- hand-off since the first letter.
--
-- Service role only. Reads the outbox and nothing else.
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
  );
$$;

comment on function public.dispatch_handed_off_since(uuid, timestamptz) is
  'True when the plan was handed to another organiser by a hand-off the drain finished with at or after p_since, so the new organiser has already had the replies-closed letter. Service role only (SUS-96).';

revoke all on function public.dispatch_handed_off_since(uuid, timestamptz) from public;
revoke all on function public.dispatch_handed_off_since(uuid, timestamptz) from anon, authenticated;
grant execute on function public.dispatch_handed_off_since(uuid, timestamptz) to service_role;

-- END GENERATED: function definitions
