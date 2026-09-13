-- ---------------------------------------------------------------------------
-- Has this request already been served?
--
-- One round trip that both claims the key and answers the question, because two
-- — read, then insert — is the race it exists to close: the duplicate a retry
-- sends arrives while the first is still running, and both reads say "new".
-- `on conflict do nothing` makes the insert itself the claim.
--
-- Four answers, and the caller does something different with each:
--
--   `fresh`     nobody has this key; go and do the work.
--   `done`      served already; hand back the recorded response verbatim.
--   `in_flight` the first attempt has not finished; the honest answer is "not
--               yet", not a second attempt at the work.
--   `mismatch`  this key was used for a *different* body. Returning the first
--               body would be confidently wrong, so it is an error instead.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.
-- ---------------------------------------------------------------------------

create or replace function public.begin_request(
  p_function text,
  p_user uuid,
  p_key text,
  p_fingerprint bytea
)
returns table (state text, response_status integer, response_body jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jobs.idempotent_requests;
begin
  insert into jobs.idempotent_requests (function_name, user_id, key, request_fingerprint)
  values (p_function, p_user, p_key, p_fingerprint)
  on conflict (function_name, user_id, key) do nothing;

  if found then
    return query select 'fresh'::text, null::integer, null::jsonb;
    return;
  end if;

  select * into existing
  from jobs.idempotent_requests r
  where r.function_name = p_function and r.user_id = p_user and r.key = p_key;

  if existing.request_fingerprint <> p_fingerprint then
    return query select 'mismatch'::text, null::integer, null::jsonb;
  elsif existing.status = 'done' then
    return query select 'done'::text, existing.response_status, existing.response_body;
  else
    return query select 'in_flight'::text, null::integer, null::jsonb;
  end if;
end;
$$;

comment on function public.begin_request(text, uuid, text, bytea) is
  'Claims an idempotency key and says whether the request is fresh, already served, still running, or the same key with a different body.';

revoke all on function public.begin_request(text, uuid, text, bytea) from public;
revoke all on function public.begin_request(text, uuid, text, bytea) from anon, authenticated;
grant execute on function public.begin_request(text, uuid, text, bytea) to service_role;
