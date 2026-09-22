-- ---------------------------------------------------------------------------
-- What the founder needs to know once a day, as counts.
--
-- Four numbers, chosen because each one is something no screen would ever show
-- and nobody would otherwise look for (S4-06 builds the diagnostics screen on
-- the same query):
--
--   * jobs that gave up in the last 24 hours;
--   * outbox rows older than ten minutes that are still unprocessed — the one
--     thing retention never deletes, however old, precisely so that this can
--     report them (ADR 0014);
--   * addresses suppressed in the last 24 hours, which is a bounce rate by
--     another name;
--   * plans still in `ready` more than 48 hours past their deadline, which is
--     an organiser who was told the replies closed and did nothing.
--
-- Counts and two timestamps, and nothing else: this value goes into an email
-- and a log line, so a plan title or an address in it would be the leak
-- non-negotiable 8 names. The lease times come from `jobs.cron_leases`, which
-- is where "did the dispatcher run at all" is recorded (S1-12).
--
-- **Claiming is what makes it daily.** The dispatcher runs every minute and
-- has no memory between runs, so "once per day at 08:00 UTC" has to be a fact
-- in the database rather than a variable in a process. The claim is a row in
-- `private.audit_log` — a fact worth keeping for a year, counts only, exactly
-- as `jobs.run_retention` records its own runs — and the function answers null
-- when today's has already been made. `p_claim => false` reads the same
-- numbers without claiming, which is what a diagnostics screen and a test want.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_health(p_claim boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  summary jsonb;
begin
  -- Whether the day is owed is `public.dispatch_health_due`'s to answer, and
  -- only its. The condition was written out again here, identically, which is
  -- one edit away from the two disagreeing — and the way they would disagree
  -- is that `due` says yes, the letter goes, the claim answers null, and the
  -- letter goes again every minute (review round 4).
  if p_claim and not public.dispatch_health_due() then
    return null;
  end if;

  select jsonb_build_object(
    'failed_jobs_24h', (
      select count(*) from jobs.notification_jobs j
      where j.status = 'failed' and j.updated_at >= now() - interval '24 hours'
    ),
    'stuck_outbox', (
      select count(*) from jobs.outbox o
      where o.processed_at is null and o.occurred_at < now() - interval '10 minutes'
    ),
    'suppressed_24h', (
      select count(*) from private.email_suppressions s
      where s.suppressed_at >= now() - interval '24 hours'
    ),
    'stuck_ready_plans', (
      select count(*) from public.plans p
      where p.state = 'ready' and p.response_deadline < now() - interval '48 hours'
    ),
    'dispatcher_last_finished_at', (
      select l.last_finished_at from jobs.cron_leases l where l.name = 'process_scheduled_jobs'
    ),
    'retention_last_finished_at', (
      select l.last_finished_at from jobs.cron_leases l where l.name = 'retention_daily'
    )
  ) into summary;

  if p_claim then
    insert into private.audit_log (action, resource_type, metadata)
    values ('health.reported', 'account', summary);
  end if;

  return summary;
end;
$$;

comment on function public.dispatch_health(boolean) is
  'The daily health summary as counts: failed jobs, stuck outbox rows, suppressions, plans stuck in ready, and when each scheduled job last finished. Claims the day''s report through private.audit_log and answers null when it is already made. No identifiers, no content. Service role only (S1-20).';

revoke all on function public.dispatch_health(boolean) from public;
revoke all on function public.dispatch_health(boolean) from anon, authenticated;
grant execute on function public.dispatch_health(boolean) to service_role;
