-- The same invariant from the other side.
--
-- Watching `circles` alone leaves it true only at the moment a circle is
-- created: removing the owner's membership later empties the ownership without
-- touching the circles row, `auth_is_owner` goes permanently false, and every
-- owner-only operation on that circle is refused for good. An owner who wants
-- out hands the circle over first — that is a real operation with its own
-- checks (spec §9), not a side effect of leaving.

create or replace function public.enforce_owner_stays_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_circle uuid := coalesce(new.circle_id, old.circle_id);
  row_user uuid := coalesce(new.user_id, old.user_id);
begin
  -- The circle itself may have gone in this transaction, taking its members
  -- with it. Nothing to protect then.
  if not exists (
    select 1 from public.circles c
    where c.id = row_circle and c.owner_user_id = row_user
  ) then
    return null;
  end if;

  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = row_circle and m.user_id = row_user and m.status = 'active'
  ) then
    raise exception 'circle % cannot remove its owner %; hand the circle over first',
      row_circle, row_user
      using errcode = 'foreign_key_violation';
  end if;

  return null;
end;
$$;

comment on function public.enforce_owner_stays_member() is
  'An owner stays an active member. Deferred, so a hand-off may change the owner and the membership in either order within one transaction.';

revoke all on function public.enforce_owner_stays_member() from public;
revoke all on function public.enforce_owner_stays_member() from anon, authenticated;
