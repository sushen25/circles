-- ---------------------------------------------------------------------------
-- The authorisation helpers.
--
-- Every one is `security definer` with an empty `search_path` and revoked from
-- `public` (§14). The empty search path is not decoration: a definer function
-- that resolves an unqualified name through the caller's path can be pointed at
-- a table the caller controls.
-- ---------------------------------------------------------------------------

create or replace function public.auth_is_member(circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circle_members m
    where m.circle_id = auth_is_member.circle_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

comment on function public.auth_is_member(uuid) is
  'True when the caller is an active member of the circle. The select policy on every circle-scoped table in the product.';

revoke all on function public.auth_is_member(uuid) from public;
grant execute on function public.auth_is_member(uuid) to anon, authenticated;
revoke all on function public.auth_is_member(uuid) from public;
revoke all on function public.auth_is_member(uuid) from anon, authenticated;
grant execute on function public.auth_is_member(uuid) to anon, authenticated;
