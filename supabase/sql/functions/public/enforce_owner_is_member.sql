create or replace function public.enforce_owner_is_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.circle_members
    where circle_id = new.id
      and user_id = new.owner_user_id
      and status = 'active'
  ) then
    raise exception 'circle % owner % must be an active member', new.id, new.owner_user_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_owner_is_member() is
  'The owner is a member (architecture §8.2). Deferred to the end of the transaction so create_circle can insert the circle and the membership in either order.';

revoke all on function public.enforce_owner_is_member() from public;
revoke all on function public.enforce_owner_is_member() from anon, authenticated;
