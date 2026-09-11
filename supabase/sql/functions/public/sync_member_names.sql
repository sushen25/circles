-- ---------------------------------------------------------------------------
-- Renaming.
--
-- The roster shows `display_name_snapshot` and `member_profiles` shows
-- `profiles.display_name`, and the uniqueness index only covers the first. A
-- member could therefore rename themselves to a co-member's name: the index saw
-- nothing change, and the circle showed two people with one name.
--
-- So while a membership is active its snapshot *follows* the profile, and the
-- index refuses the rename outright when it would collide. The snapshot stops
-- following at the moment of removal, which is what it was always for: a
-- removed member's history keeps the name they had.
-- ---------------------------------------------------------------------------

create or replace function public.sync_member_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.circle_members m
  set display_name_snapshot = new.display_name
  where m.user_id = new.user_id
    and m.status = 'active'
    and m.display_name_snapshot is distinct from new.display_name;
  return new;
end;
$$;

comment on function public.sync_member_names() is
  'Keeps an active membership''s name in step with the profile, so the uniqueness index sees a rename. Frozen on removal.';

revoke all on function public.sync_member_names() from public;
revoke all on function public.sync_member_names() from anon, authenticated;
