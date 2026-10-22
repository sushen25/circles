-- ---------------------------------------------------------------------------
-- The funnel by campaign tag and the first plans that have stopped (SUS-240),
-- as one definition for the two doors that read them (SUS-244, ADR 0087).
--
-- `founder_analytics` calls it with no source and returns every stalled first
-- plan to the founder; `content_funnel_export` calls it with `content` and
-- hands the content loop the tags and the stalled plans that came from a post.
-- Neither door does any counting of its own, so the two cannot drift.
--
-- Not callable by any client role, `service_role` included: the two definer
-- functions that call it are the way in. `p_from` is taken as given (the
-- callers have already clamped it to the Monday of a week within 400 days).
--
-- Counts and ages only. A tag is a slug chosen for a post and nothing names
-- the person who followed it (ADR 0084); no circle, plan, member, code, id or
-- address is returned.
-- ---------------------------------------------------------------------------
create or replace function private.funnel_by_tag(p_from date, p_source text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'by_source_ref', (
      select coalesce(jsonb_object_agg(r.source_ref, jsonb_build_object(
        'counters', (
          select coalesce(jsonb_object_agg(c.counter, c.n), '{}'::jsonb)
          from (
            select f.counter, sum(f.n)::int as n
            from analytics.funnel_counts f
            where f.day >= p_from and f.source_ref = r.source_ref
            group by f.counter
          ) c
        ),
        'events', (
          select coalesce(jsonb_object_agg(x.event_name, x.n), '{}'::jsonb)
          from (
            select e.event_name, count(*)::int as n
            from analytics.events e
            join analytics.event_source_ref es on es.event_id = e.id
            where es.source_ref = r.source_ref
              and e.event_name in ('plan_shared', 'availability_submitted', 'meetup_confirmed')
              and (e.occurred_at at time zone 'UTC')::date >= p_from
            group by e.event_name
          ) x
        )
      )), '{}'::jsonb)
      from (
        -- A tag with only events in the period (a plan made before it, shared
        -- in it) is listed too, after the ones with rows.
        select t.source_ref
        from (
          select f.source_ref, sum(f.n)::bigint as weight
          from analytics.funnel_counts f
          where f.day >= p_from and f.source_ref is not null
          group by f.source_ref
          union all
          select es.source_ref, 0::bigint
          from analytics.events e
          join analytics.event_source_ref es on es.event_id = e.id
          where es.source_ref is not null
            and e.event_name in ('plan_shared', 'availability_submitted', 'meetup_confirmed')
            and (e.occurred_at at time zone 'UTC')::date >= p_from
        ) t
        group by t.source_ref
        order by sum(t.weight) desc, t.source_ref
        limit 40
      ) r
    ),
    'stalled', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week', s.week,
        'cohort', s.cohort,
        'source', s.source,
        'state', s.state,
        'circles', s.circles,
        'oldest_hours', s.oldest_hours,
        'median_hours', s.median_hours
      ) order by s.week desc, s.cohort, s.source, s.state), '[]'::jsonb)
      from (
        select week, cohort, source, state,
          count(*)::int as circles,
          floor(max(age_hours))::int as oldest_hours,
          floor(percentile_cont(0.5) within group (order by age_hours))::int as median_hours
        from analytics.stalled_first_plans
        where week >= p_from
          and (p_source is null or source = p_source)
        group by week, cohort, source, state
      ) s
    )
  );
$$;

comment on function private.funnel_by_tag(date, text) is
  'The by-tag funnel (the forty busiest tags, counters and a few events each) and the first plans that have stopped, from p_from on; stalled rows only for p_source when it is not null. Counts and ages, no identifiers. The one definition behind founder_analytics and content_funnel_export; callable by neither client role nor service_role.';

revoke all on function private.funnel_by_tag(date, text) from public;
revoke all on function private.funnel_by_tag(date, text) from anon, authenticated, service_role;
