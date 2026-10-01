-- ---------------------------------------------------------------------------
-- The days somebody has picked: the fact that decides what taking a day away
-- costs (ADR 00ZZ).
--
-- Removing a day **nobody** picked keeps everybody's answers and starts no
-- new revision; removing a day somebody picked is a new question (ADR 0017).
-- `revise_plan` decides that under the plan's lock by calling this, and the
-- edit screen's preview calls it too, so the warning shown before saving and
-- the save itself read the same days the same way — the argument
-- `reask_audience` makes about who has answered.
--
-- Dates only. Not whose, not how many, not when on the day: the organiser
-- learns that *somebody* is free some time on Tuesday, which the day grid's
-- combined counts already tell every member (SUS-129). Every answer to the
-- current revision counts, the organiser's own included: their answer is
-- cleared by a new revision like anybody's.
--
-- Organiser-only, as `reask_audience` is, and for its reason: a preview of an
-- edit somebody cannot make is information they should not have.
-- ---------------------------------------------------------------------------

create or replace function public.picked_days(p_plan_id uuid)
returns setof date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan public.plans;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  if plan.organiser_user_id is distinct from (select auth.uid())
    or not exists (
      select 1 from public.circle_members m
      where m.circle_id = plan.circle_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  -- The day a window starts on, in the plan's zone: `enforce_window_shape`
  -- holds every window inside the band of the day it starts on.
  return query
  select distinct (w.starts_at at time zone plan.time_zone)::date
  from public.plan_responses r
  join public.willing_windows w on w.response_id = r.id
  where r.plan_id = plan.id and r.revision = plan.revision
  order by 1;
end;
$$;

comment on function public.picked_days(uuid) is
  'The dates on which some answer to the plan''s current revision has times, for its organiser: what decides whether taking a day away asks people again (ADR 00ZZ).';

revoke all on function public.picked_days(uuid) from public;
revoke all on function public.picked_days(uuid) from anon, authenticated;
grant execute on function public.picked_days(uuid) to authenticated;
