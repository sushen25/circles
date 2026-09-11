-- The one way in. Definer, so that a trigger firing as a member can append
-- without the member holding anything in `jobs`; callable by the service
-- role, so an Edge Function can announce what it did (invite rotated,
-- contact verified, nudge shown) without a table grant.

create or replace function jobs.emit(
  p_event_name text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into jobs.outbox (event_name, aggregate_type, aggregate_id, payload)
  values (p_event_name, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb))
  returning id;
$$;

comment on function jobs.emit(text, text, uuid, jsonb) is
  'Appends one domain event to the outbox. Every definer function and the service role write events through this; nothing else inserts into jobs.outbox.';

revoke all on function jobs.emit(text, text, uuid, jsonb) from public;
revoke all on function jobs.emit(text, text, uuid, jsonb) from anon, authenticated;
grant execute on function jobs.emit(text, text, uuid, jsonb) to service_role;
