create or replace function public.auth_is_permanent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Signed in, and not anonymous. Read from the JWT rather than from
  -- `profiles`, because a row the caller can update is not a credential.
  --
  -- A missing claim reads as anonymous. That is the safe direction: the only
  -- thing this gates is creation, and refusing a permanent user is a retry
  -- while admitting an anonymous one strands a plan (ADR 0004).
  select (select auth.uid()) is not null
     and coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous',
           'true'
         ) = 'false';
$$;

comment on function public.auth_is_permanent() is
  'True when the caller has a saved place (Apple, Google or email code). Gates circle and plan creation (ADR 0004). A missing claim reads as anonymous.';

revoke all on function public.auth_is_permanent() from public;
revoke all on function public.auth_is_permanent() from anon, authenticated;
grant execute on function public.auth_is_permanent() to anon, authenticated;
