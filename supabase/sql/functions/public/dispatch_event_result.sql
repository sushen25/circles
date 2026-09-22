-- ---------------------------------------------------------------------------
-- What became of one outbox event.
--
-- `p_error` null is success: `processed_at` is stamped and the row is never
-- read again. A code — and it must be a code, `outbox_last_error_is_a_code`
-- refuses a sentence and the reason is that an exception's text is where
-- addresses and notes turn up (non-negotiable 8) — counts an attempt and
-- leaves the row unprocessed so the next tick tries again.
--
-- After five attempts the row is stamped processed **with the error still on
-- it**. An event that has failed five times is not going to succeed on the
-- sixth, and an outbox that never drains is one the health summary reports as
-- stuck for ever. The code stays so that the row says why it was given up on.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_event_result(p_id uuid, p_error text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update jobs.outbox o set
    attempts = o.attempts + (case when p_error is null then 0 else 1 end),
    last_error = p_error,
    processed_at = case
      when p_error is null then now()
      when o.attempts + 1 >= 5 then now()
      else null
    end
  where o.id = p_id;
$$;

comment on function public.dispatch_event_result(uuid, text) is
  'Marks an outbox event processed, or counts a failed attempt against it and gives up at five. The error is a classified code, never an exception text. Service role only.';

revoke all on function public.dispatch_event_result(uuid, text) from public;
revoke all on function public.dispatch_event_result(uuid, text) from anon, authenticated;
grant execute on function public.dispatch_event_result(uuid, text) to service_role;
