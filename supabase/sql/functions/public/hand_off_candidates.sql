-- ---------------------------------------------------------------------------
-- Who the organiser could hand a plan to (spec §5.7), for the sheet that asks.
--
-- Every active member of the plan's circle but the organiser, with whether they
-- have a saved place. The sheet shows the ones without one greyed out with
-- "needs a saved place" rather than letting a tap be refused, and the client
-- cannot tell on its own: `profiles` is readable by its owner alone.
--
-- Whether somebody is a guest is not a secret in the circle — the
-- "Continue as" list names the circle's guests to anyone holding its link
-- (`guest_members_for_reattach`, ADR 0006) — but it is still only answered to
-- the one person with a use for it: the plan's organiser, while they are an
-- active member. Anybody else is refused as `not_the_organiser`, the refusal
-- the hand-off itself would give them.
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
  select m.user_id, m.display_name_snapshot, coalesce(pr.is_permanent, false)
  from public.circle_members m
  left join public.profiles pr on pr.user_id = m.user_id
  where m.circle_id = plan.circle_id
    and m.status = 'active'
    and m.user_id <> caller
  order by m.joined_at, m.user_id;
end;
$$;

comment on function public.hand_off_candidates(uuid) is
  'The active members a plan''s organiser could hand it to, each with whether they have a saved place. The calling organiser only (S2-05).';

revoke all on function public.hand_off_candidates(uuid) from public;
revoke all on function public.hand_off_candidates(uuid) from anon, authenticated;
grant execute on function public.hand_off_candidates(uuid) to authenticated;
