-- ---------------------------------------------------------------------------
-- Outcomes.
--
-- Mirrors `reportOutcome` and `lastMetAtAfter`. One insert does four things,
-- in one transaction, so none can happen without the others: the plan moves
-- to `completed` through `transition_plan` (which is where "is this the
-- organiser, and still a member" is decided — not re-derived here), the
-- confirmation closes, and the circle's `last_met_at` moves if — and only if —
-- the answer was `happened`, and only forwards.
-- ---------------------------------------------------------------------------

create or replace function public.apply_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmation public.meetup_confirmations;
  plan public.plans;
begin
  -- Lock order is plan, then confirmation — the same order `cancel` and
  -- `reopen` take (`transition_plan` locks the plan; its trigger then writes
  -- the confirmation). Locking the confirmation first here would let an
  -- outcome racing a cancel deadlock instead of one of them simply losing.
  -- The confirmation is read again after the lock, because the loser has to
  -- see what the winner did.
  select p.* into plan
  from public.plans p
  join public.meetup_confirmations c on c.plan_id = p.id
  where c.id = new.confirmation_id
  for update of p;
  select * into confirmation from public.meetup_confirmations c where c.id = new.confirmation_id;

  -- Reporting on a superseded confirmation would attach an outcome to a time
  -- that was replaced — and, through the `last_met_at` move below, could set
  -- the circle's record to an evening it explicitly abandoned.
  if confirmation.status <> 'active' then
    raise exception 'confirmation_not_active' using errcode = 'check_violation';
  end if;
  if confirmation.revision <> plan.revision then
    raise exception 'stale_confirmation' using errcode = 'check_violation';
  end if;

  -- "The morning after a confirmed meetup" (spec §5.10). Asked any earlier the
  -- question has no answer yet, and `happened` would set `last_met_at` to an
  -- instant that has not arrived — which cadence then reads.
  if now() < confirmation.ends_at then
    raise exception 'outcome_too_early' using errcode = 'check_violation';
  end if;

  -- `statusAfter`: `cancelled` is the one outcome that says the meetup did not
  -- take place at all; the other three describe a finished attempt. Closed
  -- before the transition, so the plans trigger finds nothing left to close.
  update public.meetup_confirmations c
  set status = case when new.outcome = 'cancelled' then 'cancelled' else 'completed' end,
      superseded_at = now(),
      superseded_reason = 'outcome'
  where c.id = confirmation.id;

  -- The organiser guard lives in the state machine and is not duplicated here.
  -- A non-organiser, or an organiser who has left the circle, is refused by
  -- `transition_plan` with the same code the client's `canTransition` uses —
  -- and the refusal rolls the close above back with it.
  perform planning.transition_plan(plan.id, 'report_outcome', new.reported_by);

  -- Only `happened`, to the time the circle actually met rather than to now —
  -- and never backwards. An outcome can be reported late, and a circle that has
  -- met again since must not be told it last met a fortnight ago because
  -- somebody finally answered an old email. Cadence is built on this field.
  if new.outcome = 'happened' then
    update public.circles c
    set last_met_at = greatest(coalesce(c.last_met_at, confirmation.starts_at), confirmation.starts_at)
    where c.id = plan.circle_id;
  end if;

  return new;
end;
$$;

comment on function public.apply_outcome() is
  'Mirrors reportOutcome() and lastMetAtAfter(): completes the plan through transition_plan, closes the confirmation, and moves last_met_at only for `happened`, only forwards.';

revoke all on function public.apply_outcome() from public;
revoke all on function public.apply_outcome() from anon, authenticated;
