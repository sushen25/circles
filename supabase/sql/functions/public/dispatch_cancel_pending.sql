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
-- `moved` is in it for the same reason, once the organiser can move a
-- locked-in time (ADR 0050): a second move inside the backoff of the first
-- would otherwise send "moved to Saturday" after the plan had moved on to
-- Sunday. A move supersedes the confirmation inside the same revision, so the
-- caller passes the revision the plan is still on.
--
-- `skipped`, not `failed`: nothing went wrong. The code says what happened.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_cancel_pending(
  p_plan_id uuid,
  p_revision integer,
  -- The confirmation whose letters must survive: the one a move has just made
  -- (ADR 0050). A move keeps the revision, so a retried `meetup_moved` event
  -- would otherwise skip its own jobs, and the unique key would then refuse to
  -- write them again. Null for a reopen or a cancellation, which keep nothing.
  p_keep_confirmation uuid default null
)
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
      and j.kind in ('locked_in', 'moved', 'reminder', 'did_it_happen', 'did_it_happen_participant')
      and (p_keep_confirmation is null or j.confirmation_id is distinct from p_keep_confirmation)
    returning 1
  )
  select count(*)::integer from cancelled;
$$;

comment on function public.dispatch_cancel_pending(uuid, integer, uuid) is
  'Skips the still-scheduled reminder and outcome jobs for one plan revision, when its confirmation is cancelled or superseded. Service role only (S1-20).';

revoke all on function public.dispatch_cancel_pending(uuid, integer, uuid) from public;
revoke all on function public.dispatch_cancel_pending(uuid, integer, uuid) from anon, authenticated;
grant execute on function public.dispatch_cancel_pending(uuid, integer, uuid) to service_role;
