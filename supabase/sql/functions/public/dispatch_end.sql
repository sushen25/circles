-- The other half of `public.dispatch_begin`. `jobs.release_lease` releases only
-- for the holder that took it, so a run that overran and was superseded cannot
-- hand the next one's lease away.

create or replace function public.dispatch_end(p_holder text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select jobs.release_lease('process_scheduled_jobs', p_holder);
$$;

comment on function public.dispatch_end(text) is
  'Releases the process_scheduled_jobs lease if this holder still has it. Service role only.';

revoke all on function public.dispatch_end(text) from public;
revoke all on function public.dispatch_end(text) from anon, authenticated;
grant execute on function public.dispatch_end(text) to service_role;
