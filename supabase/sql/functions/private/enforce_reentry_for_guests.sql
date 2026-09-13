-- And the owner is a guest. A saved-place member signs in; a re-entry link
-- for them would be a sign-in bypass, so it is refused at issue rather than
-- trusted at consumption.

create or replace function private.enforce_reentry_for_guests()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A spent token is history, not a bypass. The rule here is about *issuing* one
  -- — "refused at issue rather than trusted at consumption", as the header says —
  -- and a membership that becomes a saved place drags its tokens along by
  -- cascade, which used to trip this and take the whole merge with it. The
  -- alternative was deleting them, and that left an emailed `/a/<token>` link
  -- answering `token_invalid` instead of offering the account's sign-in, which is
  -- the third outcome §10 asks for.
  if new.purpose = 'reentry' and new.used_at is null and exists (
    select 1 from public.profiles p
    where p.user_id = new.membership_user_id and p.is_permanent
  ) then
    raise exception 'reentry_token_for_permanent_identity' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_reentry_for_guests() from public;
revoke all on function private.enforce_reentry_for_guests() from anon, authenticated;
