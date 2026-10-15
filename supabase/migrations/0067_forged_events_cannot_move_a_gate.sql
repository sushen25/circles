-- 0067_forged_events_cannot_move_a_gate (SUS-185)
--
-- Two functions for the analytics ingest, both service role only.
-- `analytics_member_ids` answers which of a batch's circle and plan ids the
-- caller is an active member of, so the ingest can null the rest instead of
-- filing a row against a circle the caller was never in. `record_events` takes
-- an optional `received_at` per row, so the events recorded against nobody can
-- be stored to the hour rather than to the millisecond.

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/analytics_member_ids.sql
-- ---------------------------------------------------------------------------
-- Which of a batch's circle and plan ids the caller may be counted against
-- (SUS-185).
--
-- `track-events` lifts `circle_id` and `plan_id` out of each payload into their
-- own columns, and the founder's gates read those columns. An id the caller
-- supplied is a claim, not a fact: a script could file thousands of events
-- against circles it has never seen. So the ingest asks once per batch, here,
-- and keeps an id only if the caller is an **active member** of that circle
-- (for a plan: of the circle that plan belongs to). Anything else is nulled
-- before it is stored; the event survives, attributed to no circle.
--
-- One call, one answer, whatever the batch size: the caller sends the ids the
-- batch holds, not one query per event. The service role only, like
-- `record_events`; the ids it answers about are the caller's own to learn,
-- because it returns only the ones they are already a member of.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_member_ids(
  p_user_id uuid,
  p_circle_ids uuid[],
  p_plan_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select m.circle_id
    from public.circle_members m
    where m.user_id = p_user_id
      and m.status = 'active'
      and (
        m.circle_id = any (coalesce(p_circle_ids, '{}'))
        or m.circle_id in (
          select p.circle_id from public.plans p where p.id = any (coalesce(p_plan_ids, '{}'))
        )
      )
  )
  select jsonb_build_object(
    'circle_ids', coalesce(
      (select jsonb_agg(mine.circle_id) from mine
        where mine.circle_id = any (coalesce(p_circle_ids, '{}'))),
      '[]'::jsonb),
    'plan_ids', coalesce(
      (select jsonb_agg(p.id) from public.plans p
        join mine on mine.circle_id = p.circle_id
        where p.id = any (coalesce(p_plan_ids, '{}'))),
      '[]'::jsonb)
  );
$$;

comment on function public.analytics_member_ids(uuid, uuid[], uuid[]) is
  'Of the circle ids and plan ids given, the ones the user is an active member of (a plan through its circle), as {circle_ids, plan_ids}. The analytics ingest keeps only these on a row. Service role only.';

revoke all on function public.analytics_member_ids(uuid, uuid[], uuid[]) from public;
revoke all on function public.analytics_member_ids(uuid, uuid[], uuid[]) from anon, authenticated;
grant execute on function public.analytics_member_ids(uuid, uuid[], uuid[]) to service_role;

-- supabase/sql/functions/public/record_events.sql
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
-- `received_at` is optional in a row and is `now()` when absent. The ingest
-- sends it only for the events recorded against nobody (`UNATTRIBUTED_EVENTS`),
-- rounded down to the hour: to the millisecond it is a join to whatever else
-- the same connection did at that moment (SUS-185).
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
    circle_id, plan_id, properties, occurred_at, received_at
  )
  select
    e.event_id, e.event_name, e.schema_version,
    -- A user who was deleted a moment ago still holds a bearer that verifies
    -- for the rest of its hour, and `events.user_id` is a foreign key that
    -- nulls on deletion (SUS-191). The event lands without the identity
    -- rather than failing the whole batch with it.
    case when exists (select 1 from auth.users u where u.id = e.user_id) then e.user_id end,
    e.anonymous_id,
    e.circle_id, e.plan_id, coalesce(e.properties, '{}'::jsonb), e.occurred_at,
    coalesce(e.received_at, now())
  from jsonb_to_recordset(p_rows) as e (
    event_id uuid,
    event_name text,
    schema_version integer,
    user_id uuid,
    anonymous_id text,
    circle_id uuid,
    plan_id uuid,
    properties jsonb,
    occurred_at timestamptz,
    received_at timestamptz
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

-- END GENERATED: function definitions
