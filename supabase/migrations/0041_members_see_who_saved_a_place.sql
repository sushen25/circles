-- 0041_members_see_who_saved_a_place
--
-- `public.member_profiles` gains `has_saved_place`: whether a co-member's account
-- is permanent (Apple, Google or an email code) rather than a guest on the link.
-- Circle settings says "Guest" or "Place saved" on every member row (SUS-165,
-- ADR 00XX). The view is still scoped to people the caller shares an *active*
-- circle with, so a non-member and a removed member read no row at all. The
-- column is derived (`profiles.is_permanent`, which the auth trigger only ever
-- sets one way) and nothing else of `profiles` is exposed. No table changes.

create or replace view public.member_profiles as
select p.user_id, p.display_name, p.is_permanent as has_saved_place
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
  'user_id, display_name and has_saved_place for people the caller shares an active circle with. Definer by design: the column limit is the point, and RLS cannot express one.';
