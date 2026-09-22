-- ---------------------------------------------------------------------------
-- The dispatcher's lease, reachable.
--
-- `jobs.acquire_lease` is executable by the service role and lives in `jobs`,
-- which PostgREST does not expose (`[api] schemas = ["public"]`). An Edge
-- Function reaches a database function through PostgREST or not at all, so the
-- three things `process-scheduled-jobs` does to the `jobs` schema — take the
-- lease, give it back, read and write the queues — each need a wrapper here.
--
-- The name and the TTL are written here rather than passed in. A caller that
-- could choose the lease name could run two dispatchers side by side by
-- choosing two, which is the one thing the lease exists to prevent.
--
-- **Ninety seconds, which is longer than the run's own budget of fifty.** The
-- first version matched the 55-second `pg_net` timeout, on the reasoning that
-- a run killed by that timeout should not keep the lease. That is the wrong
-- way round: `pg_net` timing out closes the HTTP call and the function keeps
-- running, so a lease that lapses at 55 seconds lapses *under* a dispatcher
-- that is still sending — and the next tick then draws the same jobs, because
-- `for update skip locked` holds only for the statement that took them
-- (review round 2). The cost of the longer lease is that a genuinely crashed
-- run blocks one further tick, which is a minute of nothing rather than a
-- second copy of somebody's email.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_begin(p_holder text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select jobs.acquire_lease('process_scheduled_jobs', interval '90 seconds', p_holder);
$$;

comment on function public.dispatch_begin(text) is
  'Takes the process_scheduled_jobs lease for 55 seconds. False while another run holds it, which means "do nothing this tick". Service role only (architecture §9.3).';

revoke all on function public.dispatch_begin(text) from public;
revoke all on function public.dispatch_begin(text) from anon, authenticated;
grant execute on function public.dispatch_begin(text) to service_role;
