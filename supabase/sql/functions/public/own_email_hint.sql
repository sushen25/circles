-- ---------------------------------------------------------------------------
-- The signed-in person's address, as the Account screen shows it: `m…@example.com`.
--
-- "No client context ever holds a raw email address" (AGENTS.md, spec §8.2).
-- The Account artboard shows the address, and its owner should be able to tell
-- which one they signed in with — so the hint is made here, on the server
-- side of the boundary, and the client is only ever handed the hint (S1-23,
-- review round 3). The first character of the local part and the domain;
-- nothing else of it.
--
-- The caller's own, from `auth.uid()`: there is no argument to name anybody
-- else by. Null for a guest, who has no address.
-- ---------------------------------------------------------------------------

create or replace function public.own_email_hint()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.email is null or position('@' in u.email) <= 1 then null
    else left(u.email, 1) || '…' || substr(u.email, position('@' in u.email))
  end
  from auth.users u
  where u.id = (select auth.uid());
$$;

comment on function public.own_email_hint() is
  'The caller''s own sign-in address as a hint (m…@example.com), so no client holds the address itself (S1-23).';

revoke all on function public.own_email_hint() from public;
revoke all on function public.own_email_hint() from anon, authenticated;
grant execute on function public.own_email_hint() to authenticated;
