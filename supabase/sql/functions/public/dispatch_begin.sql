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
-- choosing two, which is the one thing the lease exists to prevent; and a TTL
-- longer than the minute between ticks would let a crashed run block every
-- later one until it lapsed. 55 seconds is the invocation budget in
-- `jobs.invoke_process_scheduled_jobs()` (`timeout_milliseconds := 55000`), so
-- a run that is killed by that timeout has already lost the lease when the
-- next tick asks for it.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_begin(p_holder text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select jobs.acquire_lease('process_scheduled_jobs', interval '55 seconds', p_holder);
$$;

comment on function public.dispatch_begin(text) is
  'Takes the process_scheduled_jobs lease for 55 seconds. False while another run holds it, which means "do nothing this tick". Service role only (architecture §9.3).';

revoke all on function public.dispatch_begin(text) from public;
revoke all on function public.dispatch_begin(text) from anon, authenticated;
grant execute on function public.dispatch_begin(text) to service_role;
