-- ---------------------------------------------------------------------------
-- "Give it one more day" (spec §5.7), carried out.
--
-- The same three rules as `oneMoreDay` in `packages/domain/planning`, which is
-- the copy the screen asks before offering the button:
--
--   * **A day from now, or from the deadline if that is later.** Opened hours
--     after replies closed, a day counted from the deadline is not one.
--   * **Never later than thirty minutes before the last possible start.** A
--     deadline may already sit at the last start (ADR 0010), and then there is
--     nothing to give: `no_time_to_extend`, never a save that changes nothing.
--   * **Once per revision** — `plans.deadline_extended_on_revision` holds the
--     revision whose one extension has been spent: `already_extended`. An edit
--     or a reopen is a new question and earns its own day.
--
-- The write is an `adjust` through `planning.transition_plan`, which is what a
-- deadline-only change already is (spec §5.3): it costs nobody a second reply,
-- leaves a `ready` plan ready, and `revise_plan`'s own reasoning applies — a
-- passed deadline may be moved, only never *to* the past. The transition's
-- guards are checked here first, from the same table, so that a member who is
-- not organising is told that rather than that the plan was extended already.
--
-- What it sets off, it sets off by being an `adjust`: the old deadline's
-- `replies_closed` letter, if quiet hours still hold it, is dropped at send
-- time as `replies_reopened`, and the new deadline is announced when it passes
-- — once, because `replies_closed`'s occurrence is the deadline (ADR 0039).
-- ---------------------------------------------------------------------------

create or replace function public.extend_deadline(p_plan_id uuid)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  cutoff timestamptz;
  next_deadline timestamptz;
  extended public.plans;
begin
  if caller is null then
    raise exception 'extend_deadline requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from planning.transitions t where t.from_state = plan.state and t.action = 'adjust'
  ) then
    if plan.state in ('completed', 'expired', 'cancelled') then
      raise exception 'plan_is_finished' using errcode = 'P0001';
    end if;
    raise exception 'wrong_state' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller or not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = caller and m.status = 'active'
  ) then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if plan.deadline_extended_on_revision is not distinct from plan.revision then
    raise exception 'already_extended' using errcode = 'P0001';
  end if;

  cutoff := public.plan_last_possible_start(
    plan.window_end, plan.daily_end_local, plan.duration_minutes, plan.time_zone
  ) - interval '30 minutes';
  next_deadline := least(greatest(plan.response_deadline, now()) + interval '24 hours', cutoff);
  if next_deadline <= plan.response_deadline or next_deadline <= now() then
    raise exception 'no_time_to_extend' using errcode = 'P0001';
  end if;

  extended := planning.transition_plan(
    plan.id, 'adjust', caller, jsonb_build_object('response_deadline', next_deadline));

  update public.plans p
  set deadline_extended_on_revision = extended.revision
  where p.id = extended.id
  returning * into extended;

  return extended;
end;
$$;

comment on function public.extend_deadline(uuid) is
  'Gives the calling organiser''s plan one more day of replies: a day from the later of now and the deadline, never past thirty minutes before the last possible start, once per revision. An adjust through planning.transition_plan (S2-05).';

revoke all on function public.extend_deadline(uuid) from public;
revoke all on function public.extend_deadline(uuid) from anon, authenticated;
grant execute on function public.extend_deadline(uuid) to authenticated;
