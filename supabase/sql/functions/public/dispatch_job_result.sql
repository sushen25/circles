-- ---------------------------------------------------------------------------
-- What became of one notification job.
--
-- Four outcomes, and the difference between them is what happens next (spec
-- §9, architecture §13):
--
--   * `sent` — the provider took it. `provider_message_id` is how the delivery
--     webhook finds this row again, so it is stored in the same statement that
--     says the job was sent.
--   * `retry` — a transient failure. The row stays `scheduled` with a later
--     `scheduled_for`; the backoff (1, 5, 30 minutes) is the dispatcher's, and
--     what is written here is the instant it chose.
--   * `failed` — a transient failure that has run out of attempts, or a fault
--     of ours the provider will keep refusing.
--   * `skipped` — nothing went wrong and nothing should be sent: a suppressed
--     contact, a withdrawn subscription, a plan that is over, a second copy to
--     one address, a verification with nothing left to verify.
--
-- `last_error` is a classified code in every case
-- (`notification_jobs_last_error_is_a_code`). The provider's own message is
-- never persisted: it quotes the recipient's address (S1-19).
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_job_result(
  p_id uuid,
  p_outcome text,
  p_error text default null,
  p_provider_message_id text default null,
  p_next_attempt_at timestamptz default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update jobs.notification_jobs j set
    status = case p_outcome when 'retry' then 'scheduled' else p_outcome end,
    attempt_count = j.attempt_count + 1,
    last_error = case p_outcome when 'sent' then null else p_error end,
    sent_at = case p_outcome when 'sent' then now() else null end,
    provider_message_id = case p_outcome when 'sent' then p_provider_message_id else j.provider_message_id end,
    scheduled_for = case p_outcome when 'retry' then coalesce(p_next_attempt_at, now()) else j.scheduled_for end,
    updated_at = now()
  where j.id = p_id
    and p_outcome in ('sent', 'retry', 'failed', 'skipped');
$$;

comment on function public.dispatch_job_result(uuid, text, text, text, timestamptz) is
  'Records the outcome of one send: sent with its provider message id, retry with the next attempt time, or failed/skipped with a classified code. Service role only (S1-20).';

revoke all on function public.dispatch_job_result(uuid, text, text, text, timestamptz) from public;
revoke all on function public.dispatch_job_result(uuid, text, text, text, timestamptz) from anon, authenticated;
grant execute on function public.dispatch_job_result(uuid, text, text, text, timestamptz) to service_role;
