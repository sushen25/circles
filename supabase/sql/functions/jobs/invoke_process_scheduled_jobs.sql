-- ---------------------------------------------------------------------------
-- The schedule.
--
-- The minute job calls the Edge Function through pg_net. The URL and the
-- bearer are database settings — `circles.functions_url`,
-- `circles.cron_secret` — set per environment after deploy and never written
-- in a migration. Until they are set the job is a no-op, so a fresh local
-- stack does not log a failed HTTP call every minute. The call is wrapped in
-- a function so the job's command text, which anyone who can read `cron.job`
-- can read, does not contain the header expression.
-- ---------------------------------------------------------------------------

create or replace function jobs.invoke_process_scheduled_jobs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := nullif(current_setting('circles.functions_url', true), '');
  secret text := nullif(current_setting('circles.cron_secret', true), '');
begin
  if base_url is null or secret is null then
    return null;
  end if;
  return net.http_post(
    url := base_url || '/process-scheduled-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

comment on function jobs.invoke_process_scheduled_jobs() is
  'Asks process-scheduled-jobs to run, via pg_net, with the bearer from circles.cron_secret. Null and no call when the settings are absent.';

revoke all on function jobs.invoke_process_scheduled_jobs() from public;
revoke all on function jobs.invoke_process_scheduled_jobs() from anon, authenticated;
revoke all on function jobs.invoke_process_scheduled_jobs() from service_role;
