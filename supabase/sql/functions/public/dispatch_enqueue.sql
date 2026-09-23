-- ---------------------------------------------------------------------------
-- The jobs one event turned into, written in one statement.
--
-- `on conflict (idempotency_key) do nothing` is the whole of "delivery is
-- idempotent per recipient, plan revision, kind and occurrence" (spec §5.8).
-- A drain that crashes between enqueueing and marking the event processed runs
-- again and writes nothing new; a duplicate key is "already scheduled", not an
-- error (S1-11).
--
-- The count returned is of rows actually inserted, so a drain can say in its
-- log how much of what it computed was new — a number, not a recipient.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_enqueue(p_jobs jsonb)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with wanted as (
    select * from jsonb_to_recordset(coalesce(p_jobs, '[]'::jsonb)) as j (
      channel text,
      kind text,
      user_id uuid,
      contact_id uuid,
      plan_id uuid,
      plan_revision integer,
      scheduled_for timestamptz,
      idempotency_key text
    )
  ), written as (
    insert into jobs.notification_jobs (
      channel, kind, user_id, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
    )
    select w.channel, w.kind, w.user_id, w.contact_id, w.plan_id, w.plan_revision,
      w.scheduled_for, w.idempotency_key
    from wanted w
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*)::integer from written;
$$;

comment on function public.dispatch_enqueue(jsonb) is
  'Inserts notification jobs, ignoring any whose idempotency key already exists, and answers how many were new. Service role only (S1-20).';

revoke all on function public.dispatch_enqueue(jsonb) from public;
revoke all on function public.dispatch_enqueue(jsonb) from anon, authenticated;
grant execute on function public.dispatch_enqueue(jsonb) to service_role;
