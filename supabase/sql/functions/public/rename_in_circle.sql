-- ---------------------------------------------------------------------------
-- rename_in_circle
--
-- A member changes the name one circle calls them (SUS-205, ADR 0070), without
-- leaving and rejoining.
--
-- Since ADR 0065 the circle's name for a person is the only name co-members
-- see, and nothing sets it after joining. This is that one thing. It writes
-- `display_name_snapshot` on the caller's own active row in one circle, and
-- touches nothing else: not `profiles`, not any other circle, not any plan.
-- Rosters, plan screens and letters read the column when they are drawn, so a
-- plan already locked in shows the new name as soon as this commits.
--
-- **Own row only, by construction.** The row is found by `auth.uid()` and the
-- circle; there is no parameter naming another person, so the owner cannot
-- rename anybody else. A caller who is not an active member of the circle
-- (never was, was removed, or the circle does not exist) gets the one answer,
-- `member_not_found`, and the three are not told apart.
--
-- **The rules the join path has.** The name is judged as `admit_member` judges
-- it: the length is `circle_members_name_length` on the canonical form, and
-- uniqueness among the circle's active members is
-- `circle_members_active_name_idx`, answered as `duplicate_name`. Keeping the
-- name you already have is not a collision: the row is excluded from itself by
-- the index, and the call is then a no-op rewrite of the same value.
--
-- The circle row is locked first, the order `admit_member` and `remove_member`
-- take, so a rename racing a join or a removal sees one roster.
--
-- Nothing is emitted: no outbox event, no audit row. A name is not an
-- analytics fact, and an audit row would copy the name somewhere new.
-- ---------------------------------------------------------------------------

create or replace function public.rename_in_circle(
  p_circle_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  violated text;
begin
  if caller is null then
    raise exception 'rename_in_circle requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_display_name is null then
    raise exception 'display_name_unusable' using errcode = 'check_violation';
  end if;

  perform 1 from public.circles c where c.id = p_circle_id for update;

  begin
    update public.circle_members m
    set display_name_snapshot = btrim(p_display_name), updated_at = now()
    where m.circle_id = p_circle_id and m.user_id = caller and m.status = 'active';
  exception
    when unique_violation then
      get stacked diagnostics violated = constraint_name;
      if violated = 'circle_members_active_name_idx' then
        raise exception 'duplicate_name' using errcode = 'unique_violation';
      end if;
      raise;
    when check_violation then
      get stacked diagnostics violated = constraint_name;
      if violated = 'circle_members_name_length' then
        raise exception 'display_name_unusable' using errcode = 'check_violation';
      end if;
      raise;
  end;

  if not found then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.rename_in_circle(uuid, text) is
  'Changes the name one circle calls the caller, on the caller''s own active membership only (SUS-205, ADR 0070). duplicate_name, display_name_unusable, or member_not_found for anybody not active in the circle. Touches no profile, no other circle and no plan.';

revoke all on function public.rename_in_circle(uuid, text) from public;
revoke all on function public.rename_in_circle(uuid, text) from anon, authenticated;
grant execute on function public.rename_in_circle(uuid, text) to authenticated;
