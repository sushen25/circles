-- ---------------------------------------------------------------------------
-- reattach_member — the Continue-as list
--
-- A guest comes back with no session — the expected path, not the rare one
-- (ADR 0006: Safari drops script-writable storage after seven idle days, and
-- chat in-app browsers isolate it). They sign in anonymously again, pick their
-- name from the Continue-as list, and this moves the membership and everything
-- scoped to it onto the new identity.
--
-- The list names the membership and asks for nothing else, so this door stays
-- the caller's: it acts on `auth.uid()` and its limits and safeguards are
-- `private.reattach_member_core`'s. The emailed link is the other door,
-- `reattach_with_token`, and is not reachable from here: a re-entry digest in
-- this function's arguments is gone since SUS-114.
-- ---------------------------------------------------------------------------

create or replace function public.reattach_member(
  p_circle_id uuid default null,
  p_target_user_id uuid default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.reattach_member_core((select auth.uid()), p_circle_id, p_target_user_id, null, null);
end;
$$;

comment on function public.reattach_member(uuid, uuid) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list (ADR 0006). The emailed re-entry link is reattach_with_token, the service role''s. Only in an active circle and only while one of its plans is live (ADR 0059); a per-circle hourly limit; no cap on how often one membership moves (ADR 0078); never onto a saved-place member.';

revoke all on function public.reattach_member(uuid, uuid) from public;
revoke all on function public.reattach_member(uuid, uuid) from anon, authenticated;
grant execute on function public.reattach_member(uuid, uuid) to authenticated;
