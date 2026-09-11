-- And the owner is a guest. A saved-place member signs in; a re-entry link
-- for them would be a sign-in bypass, so it is refused at issue rather than
-- trusted at consumption.

create or replace function private.enforce_reentry_for_guests()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.purpose = 'reentry' and exists (
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
