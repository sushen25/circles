create or replace function public.auth_is_owner(circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circles c
    join public.circle_members m
      on m.circle_id = c.id
     and m.user_id = c.owner_user_id
     and m.status = 'active'
    where c.id = auth_is_owner.circle_id
      and c.owner_user_id = (select auth.uid())
  );
$$;

comment on function public.auth_is_owner(uuid) is
  'True when the caller owns the circle and is still an active member of it. An owner who left owns nothing.';

revoke all on function public.auth_is_owner(uuid) from public;
revoke all on function public.auth_is_owner(uuid) from anon, authenticated;
grant execute on function public.auth_is_owner(uuid) to anon, authenticated;
