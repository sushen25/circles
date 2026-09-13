-- The other half of `begin_request`: what the caller was told, so the retry can
-- be told the same thing. Writing nothing when the key is not claimed — rather
-- than inserting — keeps a response from being recorded against a request that
-- was never begun.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.

create or replace function public.finish_request(
  p_function text,
  p_user uuid,
  p_key text,
  p_status integer,
  p_body jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update jobs.idempotent_requests r
  set status = 'done',
      response_status = p_status,
      response_body = p_body,
      completed_at = now()
  where r.function_name = p_function
    and r.user_id = p_user
    and r.key = p_key
    and r.status = 'in_flight';
$$;

comment on function public.finish_request(text, uuid, text, integer, jsonb) is
  'Records the response an idempotent request produced, so a retry is answered rather than repeated.';

revoke all on function public.finish_request(text, uuid, text, integer, jsonb) from public;
revoke all on function public.finish_request(text, uuid, text, integer, jsonb) from anon, authenticated;
grant execute on function public.finish_request(text, uuid, text, integer, jsonb) to service_role;
