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
