-- ---------------------------------------------------------------------------
-- The claim, given back.
--
-- `begin_request` writes an `in_flight` row before the work starts, so that a
-- duplicate arriving mid-flight is told "not yet" rather than doing the work a
-- second time. If the work then *fails*, that row is a lie: nothing was served,
-- and the key now answers `in_flight` to every retry for as long as the row
-- lives — which retention deliberately makes forever, because an unfinished row
-- is evidence a function died.
--
-- The first version of this kit had no such function, and the hole it left was
-- the one ADR 0016 exists to close: a client that asked once, was refused for a
-- duplicate name, and asked again with a new name got `idempotency_mismatch`,
-- and with the same name got `in_progress`. Either way it could never ask again.
--
-- Only an unfinished claim is released. A `done` row is an answer somebody has
-- been given and must keep being given.
-- ---------------------------------------------------------------------------

create or replace function public.release_request(
  p_function text,
  p_user uuid,
  p_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from jobs.idempotent_requests r
  where r.function_name = p_function
    and r.user_id = p_user
    and r.key = p_key
    and r.status = 'in_flight';
$$;

comment on function public.release_request(text, uuid, text) is
  'Gives back an unfinished idempotency claim so a failed request can be retried. Never touches a served one.';

revoke all on function public.release_request(text, uuid, text) from public;
revoke all on function public.release_request(text, uuid, text) from anon, authenticated;
grant execute on function public.release_request(text, uuid, text) to service_role;
