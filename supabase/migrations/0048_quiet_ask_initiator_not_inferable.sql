-- 0048_quiet_ask_initiator_not_inferable
--
-- A quiet ask's initiator cannot be inferred by co-members (SUS-181, ADR 0060).
-- Only somebody with a saved place who has not muted quiet asks can start one,
-- so a co-member who could read "has a saved place" and the mute flags could
-- narrow the initiator to one person in a small, new circle. They could read
-- both: `member_profiles.has_saved_place` (ADR 0056) and, through the roster
-- policy, every `circle_members` column. Neither is product data a member needs
-- about another member.
--
-- Changes:
--   * public.member_profiles loses has_saved_place (name and id again);
--   * circle_members is no longer readable by co-members. The select policy is
--     the caller's own active row, and the table grant is the columns that row
--     needs (the caller's own mute flags and name). Removed rows are
--     unreadable by anyone but the database. This closes SUS-115;
--   * public.circle_roster (new view): the active members of the caller's
--     circles, roster columns only (no mute flags, no saved place, no status);
--   * public.circle_saved_places (new): the owner reads every active member's
--     flag, any other member only their own;
--   * public.plan_roster (new): names for the ids a plan screen mentions,
--     removed members included only where the plan itself names them;
--   * public.hand_off_candidates: has_saved_place is answered to the circle's
--     owner and is null for any other organiser.
-- Existing rows are untouched.

-- A view cannot lose a column in place.
drop view public.member_profiles;

create view public.member_profiles as
select p.user_id, p.display_name
from public.profiles p
where exists (
  select 1
  from public.circle_members mine
  join public.circle_members theirs on theirs.circle_id = mine.circle_id
  where mine.user_id = (select auth.uid())
    and mine.status = 'active'
    and theirs.user_id = p.user_id
    and theirs.status = 'active'
);

comment on view public.member_profiles is
  'user_id and display_name for people the caller shares an active circle with. Definer by design: the column limit is the point, and RLS cannot express one. Not whether somebody has saved a place (ADR 0060).';

revoke all on public.member_profiles from anon, authenticated;
grant select on public.member_profiles to authenticated;

-- The roster: who is in the circles the caller is active in, and when they
-- joined. Definer, because the table is no longer readable across rows.
create view public.circle_roster as
select theirs.circle_id, theirs.user_id, theirs.display_name_snapshot, theirs.role, theirs.joined_at
from public.circle_members theirs
where theirs.status = 'active'
  and exists (
    select 1
    from public.circle_members mine
    where mine.circle_id = theirs.circle_id
      and mine.user_id = (select auth.uid())
      and mine.status = 'active'
  );

comment on view public.circle_roster is
  'The active members of the circles the caller is an active member of: id, the circle''s name for them, role and join time. No mute flag, no saved-place state, no removed row (ADR 0060). Definer by design: the column limit is the point.';

revoke all on public.circle_roster from anon, authenticated;
grant select on public.circle_roster to authenticated;

-- circle_members: a member reads their own active row (their mute switches and
-- name) and no other. The grant is the columns that row is read for.
drop policy circle_members_select_member on public.circle_members;

create policy circle_members_select_own on public.circle_members
  for select to authenticated
  using (user_id = (select auth.uid()) and public.auth_is_member(circle_id));

revoke select on public.circle_members from authenticated;
grant select (
  circle_id, user_id, display_name_snapshot, role, status, joined_at,
  muted_quiet_asks, muted_all, muted_nudges
) on public.circle_members to authenticated;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/circle_saved_places.sql
-- ---------------------------------------------------------------------------
-- Who in a circle has saved a place (spec §5.4, §8.2, ADR 0060).
--
-- A quiet ask can only be started by somebody with a saved place who has not
-- muted quiet asks (`create_quiet_ask`), so a readable "who has saved a place"
-- narrows who started one. Nobody who is only a member reads it, therefore:
--
--   * the circle's **owner** gets a row for every active member, which is
--     what Circle settings shows beside each name (SUS-165, ADR 0056). The
--     owner is the one person who always has a saved place and chose who is
--     in the circle; ADR 0060 says why that is accepted;
--   * **any other active member** gets their own row and nobody else's, so
--     "You · guest" and "You · place saved" still read;
--   * anybody else, a removed member included, gets nothing.
--
-- The flag is `profiles.is_permanent`, derived at read time so it cannot go
-- stale. Nothing else of `profiles` is returned.
-- ---------------------------------------------------------------------------

create or replace function public.circle_saved_places(p_circle_id uuid)
returns table (member_user_id uuid, has_saved_place boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null
    or not exists (
      select 1 from public.circle_members mine
      where mine.circle_id = p_circle_id and mine.user_id = caller and mine.status = 'active'
    )
  then
    return;
  end if;

  return query
  select m.user_id, coalesce(pr.is_permanent, false)
  from public.circle_members m
  left join public.profiles pr on pr.user_id = m.user_id
  where m.circle_id = p_circle_id
    and m.status = 'active'
    and (m.user_id = caller or public.auth_is_owner(p_circle_id))
  order by m.joined_at, m.user_id;
end;
$$;

comment on function public.circle_saved_places(uuid) is
  'Whether each active member has a saved place, for the circle''s owner; the caller''s own row for any other active member; nothing for anybody else. Quiet-ask initiators are never inferable from product data (ADR 0060).';

revoke all on function public.circle_saved_places(uuid) from public;
revoke all on function public.circle_saved_places(uuid) from anon, authenticated;
grant execute on function public.circle_saved_places(uuid) to authenticated;

-- supabase/sql/functions/public/hand_off_candidates.sql
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

-- supabase/sql/functions/public/plan_roster.sql
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

-- END GENERATED: function definitions
