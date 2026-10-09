-- ---------------------------------------------------------------------------
-- The names a plan screen needs for ids (ADR 0060).
--
-- A plan screen names everybody it mentions: the circle's active members, and
-- also a required member who has since left, so the organiser can take them
-- off ("Change who has to be there", spec §9) and a near-miss can say who was
-- missing. `circle_members` is no longer readable by co-members (it carries
-- the mute flags), and the roster view lists active members only, so this is
-- the one place a removed member's name can still be read, and only for a
-- person the plan itself already names: a required member or a participant of
-- its current revision. Everyone else who left stays unreadable.
--
-- Answers an active member of the plan's circle and nobody else. Names are the
-- circle's own snapshots, as every roster read shows; no mute flag, no saved
-- place, no timestamp but the join.
-- ---------------------------------------------------------------------------

create or replace function public.plan_roster(p_plan_id uuid)
returns table (user_id uuid, display_name text, active boolean, joined_at timestamptz)
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
  if not found
    or caller is null
    or not exists (
      select 1 from public.circle_members mine
      where mine.circle_id = plan.circle_id and mine.user_id = caller and mine.status = 'active'
    )
  then
    return;
  end if;

  return query
  select m.user_id, m.display_name_snapshot, (m.status = 'active'), m.joined_at
  from public.circle_members m
  where m.circle_id = plan.circle_id
    and (
      m.status = 'active'
      or exists (
        select 1 from public.plan_required_members r
        where r.plan_id = plan.id and r.revision = plan.revision and r.user_id = m.user_id
      )
      or exists (
        select 1 from public.plan_participants pp
        where pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = m.user_id
      )
    )
  order by m.joined_at, m.user_id;
end;
$$;

comment on function public.plan_roster(uuid) is
  'The plan circle''s active members, and a removed member only when the plan''s current revision requires or asks them: names for ids on a plan screen. An active member of that circle only (ADR 0060).';

revoke all on function public.plan_roster(uuid) from public;
revoke all on function public.plan_roster(uuid) from anon, authenticated;
grant execute on function public.plan_roster(uuid) to authenticated;
