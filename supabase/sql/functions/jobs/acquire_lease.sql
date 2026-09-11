-- ---------------------------------------------------------------------------
-- The lease.
--
-- One row per job name (0006). Taking it is one statement: an insert that
-- turns into an update only when the previous lease has lapsed, so two
-- callers racing for it cannot both win — the row lock decides, not the
-- clock they each read.
-- ---------------------------------------------------------------------------

create or replace function jobs.acquire_lease(p_name text, p_ttl interval, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  acquired boolean;
begin
  if p_ttl <= interval '0' then
    raise exception 'lease ttl must be positive' using errcode = 'check_violation';
  end if;

  insert into jobs.cron_leases as l (name, leased_until, holder, last_started_at)
  values (p_name, now() + p_ttl, p_holder, now())
  on conflict (name) do update
    set leased_until = excluded.leased_until,
        holder = excluded.holder,
        last_started_at = excluded.last_started_at
    where l.leased_until is null or l.leased_until < now()
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

comment on function jobs.acquire_lease(text, interval, text) is
  'True when the caller now holds the named lease until now() + ttl. False while somebody else holds it. One statement, so a race has one winner.';

revoke all on function jobs.acquire_lease(text, interval, text) from public;
revoke all on function jobs.acquire_lease(text, interval, text) from anon, authenticated;
grant execute on function jobs.acquire_lease(text, interval, text) to service_role;
