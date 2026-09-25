-- ---------------------------------------------------------------------------
-- A newer "replies are closed" takes the place of one still waiting (S2-05).
--
-- `replies_closed` is once per deadline (ADR 00XX), and a letter written for
-- one deadline can wait for quiet hours while the organiser moves the
-- deadline and it passes again. At 08:00 both would be true of a plan whose
-- replies are closed and nothing is locked in, so both would go — two
-- identical letters. The send-time check cannot tell them apart: a job does
-- not carry the deadline it was written for.
--
-- So the drain, before it writes a `replies_closed`, skips every one still
-- `scheduled` for the plan except the ones it is about to write (`p_keep`, by
-- idempotency key). The exception is what makes a re-drained event safe: a
-- drain that crashed after enqueueing and runs again must not skip the job it
-- wrote the first time and then find its own key already taken.
--
-- `skipped` / `superseded`, as `dispatch_cancel_pending` records it.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_supersede_closing(p_plan_id uuid, p_keep text[])
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with superseded as (
    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'superseded', updated_at = now()
    where j.plan_id = p_plan_id
      and j.kind = 'replies_closed'
      and j.status = 'scheduled'
      and j.idempotency_key <> all (coalesce(p_keep, array[]::text[]))
    returning 1
  )
  select count(*)::integer from superseded;
$$;

comment on function public.dispatch_supersede_closing(uuid, text[]) is
  'Skips the still-scheduled replies_closed jobs for a plan, except the keys about to be written, when a newer one is written. Service role only (S2-05).';

revoke all on function public.dispatch_supersede_closing(uuid, text[]) from public;
revoke all on function public.dispatch_supersede_closing(uuid, text[]) from anon, authenticated;
grant execute on function public.dispatch_supersede_closing(uuid, text[]) to service_role;
