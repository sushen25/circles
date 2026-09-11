create or replace function private.apply_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tombstone private.email_suppressions;
begin
  select * into tombstone from private.email_suppressions t
  where t.email_hash = extensions.digest(new.email_normalized, 'sha256');
  if found then
    new.status := 'suppressed';
    new.suppression_reason := tombstone.reason;
    new.suppressed_at := tombstone.suppressed_at;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_suppression() from public;
revoke all on function private.apply_suppression() from anon, authenticated;
