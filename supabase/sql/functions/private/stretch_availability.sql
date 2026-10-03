-- ---------------------------------------------------------------------------
-- Who can make a stretch of time (ADR 0051).
--
-- `whoCanMake` in `packages/domain`, which the engine itself calls for every
-- start it enumerates: a member whose willing windows fully contain the stretch,
-- or who said "I'm easy", can make it. Everybody the plan is asking who answered
-- otherwise cannot, and somebody who has not answered is a third group, never
-- "cannot" — the screens say "Alex hasn't answered", not "doesn't work for Alex"
-- (manifesto §3.5).
--
-- The roster and the order are `engine_input`'s: the people the current
-- revision was asked of who are still active members, by when they joined and
-- then by id, so every list here is in the order the engine reports. Only
-- answers to the plan's current revision count.
--
-- Returns user ids and nothing else: no window, no status. The organiser reads
-- it through `public.stretch_availability`, and the confirmation freezes it.
-- ---------------------------------------------------------------------------

create or replace function private.stretch_availability(
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select p.id, p.circle_id, p.revision from public.plans p where p.id = p_plan_id
  ),
  roster as (
    select pp.user_id, pp.joined_at
    from plan
    join public.plan_participants pp on pp.plan_id = plan.id and pp.revision = plan.revision
    join public.circle_members m
      on m.circle_id = plan.circle_id and m.user_id = pp.user_id and m.status = 'active'
  ),
  verdict as (
    select
      ro.user_id,
      ro.joined_at,
      case
        when r.id is null then 'awaiting'
        when r.status = 'flexible' then 'available'
        when r.status = 'windows' and exists (
          select 1 from public.willing_windows w
          where w.response_id = r.id and w.starts_at <= p_starts_at and w.ends_at >= p_ends_at
        ) then 'available'
        else 'cannot'
      end as verdict
    from roster ro
    cross join plan
    left join public.plan_responses r
      on r.plan_id = plan.id and r.revision = plan.revision and r.user_id = ro.user_id
  )
  select jsonb_build_object(
    'available', coalesce(jsonb_agg(v.user_id order by v.joined_at, v.user_id)
      filter (where v.verdict = 'available'), '[]'::jsonb),
    'cannot', coalesce(jsonb_agg(v.user_id order by v.joined_at, v.user_id)
      filter (where v.verdict = 'cannot'), '[]'::jsonb),
    'awaiting', coalesce(jsonb_agg(v.user_id order by v.joined_at, v.user_id)
      filter (where v.verdict = 'awaiting'), '[]'::jsonb)
  )
  from verdict v;
$$;

comment on function private.stretch_availability(uuid, timestamptz, timestamptz) is
  'Who of the people the plan is asking can make a stretch, who answered otherwise and who has not answered, as whoCanMake has it in the domain: windows that fully contain it, or "I''m easy". Ids only (ADR 0051).';

revoke all on function private.stretch_availability(uuid, timestamptz, timestamptz) from public;
revoke all on function private.stretch_availability(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function private.stretch_availability(uuid, timestamptz, timestamptz) to service_role;
