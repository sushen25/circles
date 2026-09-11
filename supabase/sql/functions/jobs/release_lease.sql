create or replace function jobs.release_lease(p_name text, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  -- Only the holder releases. A late finisher whose lease has already been
  -- taken over must not release the new holder's.
  update jobs.cron_leases l
  set leased_until = null, last_finished_at = now()
  where l.name = p_name and l.holder = p_holder and l.leased_until is not null
  returning true into released;
  return coalesce(released, false);
end;
$$;

comment on function jobs.release_lease(text, text) is
  'Releases the named lease if the caller holds it. False otherwise — a lease that lapsed and was taken by another holder stays theirs.';

revoke all on function jobs.release_lease(text, text) from public;
revoke all on function jobs.release_lease(text, text) from anon, authenticated;
grant execute on function jobs.release_lease(text, text) to service_role;
