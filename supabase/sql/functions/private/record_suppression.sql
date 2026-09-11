create or replace function private.record_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'suppressed' and (tg_op = 'INSERT' or old.status is distinct from 'suppressed') then
    insert into private.email_suppressions (email_hash, reason, suppressed_at)
    values (new.email_hash, new.suppression_reason, new.suppressed_at)
    on conflict (email_hash) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function private.record_suppression() from public;
revoke all on function private.record_suppression() from anon, authenticated;
