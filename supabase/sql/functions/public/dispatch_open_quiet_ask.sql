-- ---------------------------------------------------------------------------
-- The sweep's half of a held quiet ask (ADR 0035).
--
-- An ask that met its threshold while the circle had a plan finding a time
-- stayed `seeking`. `dispatch_timed_work` names the held asks whose circle is
-- free again; the dispatcher works out each one's deadline with the domain's
-- `defaultDeadline` and hands it here, and `planning.open_quiet_ask` tries the
-- crossing again under the plan's lock — the same attempt an answer makes, so
-- a sweep and an answer arriving together open it once between them.
--
-- The other half is every answer: `record_interest` tries the same crossing
-- on each one, a repeat included. Between them a held ask opens within a
-- minute of its circle coming free, and from its stop time it only expires.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_open_quiet_ask(p_plan_id uuid, p_deadline timestamptz)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select planning.open_quiet_ask(p_plan_id, p_deadline);
$$;

comment on function public.dispatch_open_quiet_ask(uuid, timestamptz) is
  'Tries again to open a held quiet ask, with the response deadline the domain gives it now. True if it opened. Service role only (S2-02).';

revoke all on function public.dispatch_open_quiet_ask(uuid, timestamptz) from public;
revoke all on function public.dispatch_open_quiet_ask(uuid, timestamptz) from anon, authenticated;
grant execute on function public.dispatch_open_quiet_ask(uuid, timestamptz) to service_role;
