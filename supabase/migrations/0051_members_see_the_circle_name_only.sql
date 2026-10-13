-- 0051_members_see_the_circle_name_only
--
-- Co-members see the per-circle name and nothing else (SUS-184, ADR 0065).
-- The join screen says "This is only what {circle} will call you. Your account
-- keeps its own name." The database did the opposite in two places:
--
--   * public.member_profiles returned profiles.display_name, the account name,
--     for everybody who shares an active circle;
--   * public.sync_member_names overwrote every active membership's
--     display_name_snapshot whenever the account name changed, so the name a
--     circle knew you by was neither private nor stable.
--
-- Changes:
--   * member_profiles is dropped. Nothing reads it: the roster is
--     public.circle_roster (the per-circle name, ADR 0060) and a plan screen's
--     names are public.plan_roster. A view of only an id would be an empty
--     promise, and a column on it later would be a leak again;
--   * the profiles_sync_member_names trigger and public.sync_member_names are
--     dropped, so a rename touches profiles and nothing else. The snapshot is
--     set when somebody joins or rejoins a circle and by nothing after that.
--     The uniqueness index (circle_members_active_name_idx) covers the only
--     name co-members see, so a rename can no longer produce two people with
--     one name in a circle;
--   * the profiles comment stops saying other members may see display_name.
--
-- Removed members' rows were already unreadable (0048, ADR 0060): the table's
-- select policy is the caller's own active row. Existing rows are untouched.

drop view public.member_profiles;

drop trigger profiles_sync_member_names on public.profiles;
drop function public.sync_member_names();

comment on table public.profiles is
  'One row per auth user. Created by handle_new_user(). Readable by its owner alone: co-members see the name a circle knows somebody by (circle_members.display_name_snapshot, through circle_roster), never this one (ADR 0065).';
