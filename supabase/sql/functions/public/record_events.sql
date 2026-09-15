-- ---------------------------------------------------------------------------
-- The write half of the analytics ingest.
--
-- In SQL rather than as a `.from('events').insert(...)` because `analytics` is
-- not a schema PostgREST exposes, and should not become one: the table grants
-- the service role `select, insert` and nothing else, and a client that could
-- reach it directly would be a client that could write its own history.
--
-- The validating half stays in TypeScript, where the catalogue is
-- (`packages/contracts/analytics.ts` — a Zod schema per event, per version).
-- This is deliberately dumb: it takes rows that have already been checked and
-- lands them. What it adds is the one thing only the database can promise —
-- `on conflict do nothing`, so a client that resends a batch it could not
-- confirm does not inflate a funnel.
--
-- `p_user_id` is a parameter rather than `auth.uid()` for the same reason
-- `request_email_updates`'s is: the caller is the service role, so there is no
-- session for the database to ask about, and the Edge Function above has
-- already verified the bearer it came from.
--
-- What it does *not* check is content, and that is not an omission: the table's
-- own `events_properties_carry_no_content` refuses a key or a value that could
-- carry somebody's words, which is §15's rule kept where a bug in this function
-- cannot get past it.
-- ---------------------------------------------------------------------------

create or replace function public.record_events(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into analytics.events (
    event_id, event_name, schema_version, user_id, anonymous_id,
    circle_id, plan_id, properties, occurred_at
  )
  select
    e.event_id, e.event_name, e.schema_version, e.user_id, e.anonymous_id,
    e.circle_id, e.plan_id, coalesce(e.properties, '{}'::jsonb), e.occurred_at
  from jsonb_to_recordset(p_rows) as e (
    event_id uuid,
    event_name text,
    schema_version integer,
    user_id uuid,
    anonymous_id text,
    circle_id uuid,
    plan_id uuid,
    properties jsonb,
    occurred_at timestamptz
  )
  on conflict (event_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.record_events(jsonb) is
  'Inserts already-validated analytics events, ignoring any whose event_id is already stored. Returns how many were new to the table. Service role only; the catalogue is the validation and lives in packages/contracts.';

revoke all on function public.record_events(jsonb) from public;
revoke all on function public.record_events(jsonb) from anon, authenticated;
grant execute on function public.record_events(jsonb) to service_role;
