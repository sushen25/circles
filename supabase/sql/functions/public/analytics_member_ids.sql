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
