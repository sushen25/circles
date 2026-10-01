-- ---------------------------------------------------------------------------
-- 0029 — The cron dispatcher reads its URL and bearer from Vault (SUS-127).
--
-- `jobs.invoke_process_scheduled_jobs()` read `circles.functions_url` and
-- `circles.cron_secret`, two database settings the runbook said to set with
-- `alter database postgres set …` after the first deploy. A hosted project
-- refuses that (42501, "permission denied to set parameter"): its `postgres`
-- role is not a superuser, and a custom setting needs one. So on `dev` and
-- `prod` the minute job has been a no-op since it was scheduled, and nothing
-- scheduled — reminders, replies closed, quiet letters, cadence nudges,
-- expiry, the health report — has ever run on a hosted project.
--
-- It now reads two Vault secrets, `circles_functions_url` and
-- `circles_cron_secret`, which the founder creates in the SQL editor after
-- this deploys (`docs/runbooks/environments.md`). Until both exist it is still
-- a no-op. Nothing else changes: the schedule, the job's command text and the
-- grants are as `0007` left them.
--
-- Only the function changes, and it is one statement, so no transaction.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/jobs/invoke_process_scheduled_jobs.sql
-- ---------------------------------------------------------------------------
-- The schedule.
--
-- The minute job calls the Edge Function through pg_net. The URL and the
-- bearer are **Vault secrets** — `circles_functions_url` and
-- `circles_cron_secret` — created per environment after deploy and never
-- written in a migration (SUS-127). They used to be database settings
-- (`alter database postgres set circles.…`), which a hosted project refuses:
-- its `postgres` role is not a superuser and cannot create a custom setting,
-- so the job was a no-op on every hosted project. Vault is what Supabase
-- documents for exactly this, and `postgres` may write to it.
--
-- Until both exist the job is a no-op, so a fresh project or a local stack
-- does not log a failed HTTP call every minute. The call is wrapped in a
-- function so the job's command text, which anyone who can read `cron.job`
-- can read, does not contain the header expression.
-- ---------------------------------------------------------------------------

create or replace function jobs.invoke_process_scheduled_jobs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := nullif((
    select decrypted_secret from vault.decrypted_secrets where name = 'circles_functions_url'
  ), '');
  secret text := nullif((
    select decrypted_secret from vault.decrypted_secrets where name = 'circles_cron_secret'
  ), '');
begin
  if base_url is null or secret is null then
    return null;
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/process-scheduled-jobs',
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
  'Asks process-scheduled-jobs to run, via pg_net, with the bearer from the Vault secret circles_cron_secret. Null and no call while circles_functions_url or circles_cron_secret is missing from Vault.';

revoke all on function jobs.invoke_process_scheduled_jobs() from public;
revoke all on function jobs.invoke_process_scheduled_jobs() from anon, authenticated;
revoke all on function jobs.invoke_process_scheduled_jobs() from service_role;

-- END GENERATED: function definitions
