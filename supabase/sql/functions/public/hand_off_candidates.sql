-- ---------------------------------------------------------------------------
-- Who the organiser could hand a plan to (spec §5.7), for the sheet that asks.
--
-- Every active member the plan's current revision is asking, but the
-- organiser, with whether they have a saved place — the people
-- `hand_off_target` could accept but for that. Somebody in the circle the plan
-- never asked is not listed: its letters could not reach them. For the circle's
-- owner the sheet shows the ones without one greyed out with "needs a saved
-- place" rather than letting a tap be refused.
--
-- The flag is answered to the **owner** only; for any other organiser it is
-- null, and the sheet offers everybody. Who has a saved place narrows who could
-- have started a quiet ask (spec §5.4), so it is not read by a member for
-- another member (ADR 0060). The organiser is refused as `not_the_organiser`
-- when they are not the plan's organiser, an active member.
--
-- Names are the circle's own snapshots, as every other roster read shows.
-- ---------------------------------------------------------------------------

create or replace function public.hand_off_candidates(p_plan_id uuid)
returns table (member_user_id uuid, display_name text, has_saved_place boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if caller is null
    or plan.organiser_user_id is distinct from caller
    or not exists (
      select 1 from public.circle_members m
      where m.circle_id = plan.circle_id and m.user_id = caller and m.status = 'active'
    )
  then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  return query
  select m.user_id, m.display_name_snapshot,
    case when public.auth_is_owner(plan.circle_id) then coalesce(pr.is_permanent, false) end
  from public.circle_members m
  left join public.profiles pr on pr.user_id = m.user_id
  join public.plan_participants pp
    on pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = m.user_id
  where m.circle_id = plan.circle_id
    and m.status = 'active'
    and m.user_id <> caller
  order by pp.joined_at, m.user_id;
end;
$$;

comment on function public.hand_off_candidates(uuid) is
  'The active members a plan''s current revision asks, but its organiser, each with whether they have a saved place when the caller owns the circle, null otherwise: whom the organiser could hand it to. The calling organiser only (S2-05, ADR 0060).';

revoke all on function public.hand_off_candidates(uuid) from public;
revoke all on function public.hand_off_candidates(uuid) from anon, authenticated;
grant execute on function public.hand_off_candidates(uuid) to authenticated;
