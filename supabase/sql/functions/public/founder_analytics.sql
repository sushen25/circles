-- ---------------------------------------------------------------------------
-- The founder's analytics screen, to one pair of eyes (SUS-166).
--
-- The north star, the decision gates' two numbers each (counted once for the
-- founder cohort's circles and once for the external cohort's, spec §11.4,
-- ADR 0058, and never pooled), the funnel's row
-- counts and every event's weekly count with its boolean and enum splits, from
-- the Monday of the week `p_since` falls in, as one object.
--
-- **The allowlist is the same one as `founder_summary`'s and is checked the
-- same way: against `auth.uid()`, never a parameter.** A function that takes
-- the user it should authorise authorises whoever calls it. Everybody else,
-- `anon` included, is refused with `insufficient_privilege` before the period
-- is even looked at.
--
-- **What comes back names nobody and nothing.** Every number is a count, a
-- ratio's two halves, or one median. No view it reads has a user, anonymous,
-- circle or plan id as a column that is returned: `event_breakdown` drops
-- identifiers and anything that is not a boolean or an enum word in SQL, and
-- the unattributed events are totals. The client is handed what it may show
-- and is not trusted to leave the rest out.
--
-- A gate this does not return is a gate nothing computes, and the screen says
-- so ("Not measured"); a gate returned with a zero denominator is one with no
-- data yet, which is a different sentence.
--
-- `by_source` is the same counters and event totals split by the owner's answer
-- to "How did you hear about Wenna?", counts only (SUS-171).
--
-- `by_source_ref` is the counters and a few event totals split by the campaign
-- tag the organiser arrived on (SUS-240): a label for a post, never for a
-- person, so it is the one string key this returns, and it is the founder's own
-- to read. `stalled` is the first plans that have stopped, by the week the
-- circle began and the source, as counts and ages (SUS-240).
--
-- The period is clamped to 400 days: it is a cost bound, not a rule, and the
-- answer says from when it is.
-- ---------------------------------------------------------------------------
create or replace function public.founder_analytics(p_since date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  v_from date;
  v_tags jsonb;
begin
  if caller is null or not exists (
    select 1 from private.allowlist a where a.user_id = caller
  ) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;

  if p_since is null then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_from := date_trunc('week', greatest(p_since, current_date - 400))::date;
  v_tags := private.funnel_by_tag(v_from, null);

  return jsonb_build_object(
    'since', v_from,
    'north_star', (
      select coalesce(jsonb_agg(to_jsonb(v) order by v.month), '[]'::jsonb)
      from analytics.north_star_monthly v
      where v.month >= date_trunc('month', v_from)
    ),
    -- Every gate is counted once per cohort (spec §11.4); the screen reads the
    -- founder cohort's gates from `founder` and the external cohort's from
    -- `external`. Nothing is pooled.
    'gates', (
      select jsonb_object_agg(k.cohort, jsonb_build_object(
          'confirmed_meetup', (
            select jsonb_build_object(
              'numerator', coalesce(sum(confirmed), 0)::int, 'denominator', coalesce(sum(circles), 0)::int)
            from analytics.gate_circles_confirm where day >= v_from and cohort = k.cohort),
          'unchased', (
            select jsonb_build_object(
              'numerator', coalesce(sum(unchased), 0)::int, 'denominator', coalesce(sum(members), 0)::int,
              'unanswered', coalesce(sum(unanswered), 0)::int)
            from analytics.gate_unchased where day >= v_from and cohort = k.cohort),
          'response_time', (
            select jsonb_build_object(
              'median_seconds', percentile_cont(0.5) within group (order by seconds), 'n', count(*)::int)
            from analytics.open_to_response where day >= v_from and cohort = k.cohort),
          'happened', (
            select jsonb_build_object(
              'numerator', coalesce(sum(happened), 0)::int, 'denominator', coalesce(sum(meetups), 0)::int)
            from analytics.gate_happened where day >= v_from and cohort = k.cohort),
          'reattach', (
            select jsonb_build_object(
              'numerator', coalesce(sum(reattached), 0)::int, 'denominator', coalesce(sum(missing), 0)::int)
            from analytics.gate_reattach where day >= v_from and cohort = k.cohort),
          'second_meetup', (
            select jsonb_build_object('count', coalesce(sum(circles), 0)::int)
            from analytics.gate_second_meetup where day >= v_from and cohort = k.cohort),
          'other_organiser', (
            select jsonb_build_object('count', coalesce(sum(plans), 0)::int)
            from analytics.gate_other_organiser where day >= v_from and cohort = k.cohort),
          'email_verified', (
            select jsonb_build_object(
              'numerator', coalesce(sum(verified), 0)::int, 'denominator', coalesce(sum(submitted), 0)::int)
            from analytics.gate_email_verified where day >= v_from and cohort = k.cohort),
          'confirm_in_week', (
            select jsonb_build_object(
              'numerator', coalesce(sum(confirmed_in_week), 0)::int, 'denominator', coalesce(sum(circles), 0)::int)
            from analytics.gate_confirm_in_week where day >= v_from and cohort = k.cohort),
          'another_in_cadence', (
            select jsonb_build_object(
              'numerator', coalesce(sum(another), 0)::int, 'denominator', coalesce(sum(successful), 0)::int)
            from analytics.gate_another_in_cadence where day >= v_from and cohort = k.cohort),
          'claim_moments', (
            select jsonb_build_object(
              'numerator', coalesce(sum(elsewhere), 0)::int, 'denominator', coalesce(sum(claims), 0)::int)
            from analytics.gate_claim_moments where day >= v_from and cohort = k.cohort)
      ))
      from (values ('founder'), ('external')) as k(cohort)
    ),
    'cohort_circles', (
      select coalesce(jsonb_object_agg(k.cohort, (
        select count(*)::int from analytics.circle_cohort cc where cc.cohort = k.cohort
      )), '{}'::jsonb)
      from (values ('founder'), ('external')) as k(cohort)
    ),
    'counters', (
      select coalesce(jsonb_object_agg(c.counter, c.n), '{}'::jsonb)
      from (
        select f.counter, sum(f.n)::int as n
        from analytics.funnel_counts f
        where f.day >= v_from
        group by f.counter
        union all
        select 'second_meetup_circles', coalesce(sum(s.circles), 0)::int
        from analytics.gate_second_meetup s
        where s.day >= v_from
      ) c
    ),
    -- The funnel by "How did you hear about Wenna?" (SUS-171): per source, the
    -- same row counts and every event's total. A source is an answer to a
    -- question, a circle's or an event's the owner's: nobody is named, and a
    -- source with nothing in it comes back as empty objects.
    'by_source', (
      select jsonb_object_agg(s.source, jsonb_build_object(
        'counters', (
          select coalesce(jsonb_object_agg(c.counter, c.n), '{}'::jsonb)
          from (
            select f.counter, sum(f.n)::int as n
            from analytics.funnel_counts f
            where f.day >= v_from and f.source = s.source
            group by f.counter
            union all
            select 'second_meetup_circles', coalesce(sum(g.circles), 0)::int
            from analytics.gate_second_meetup g
            where g.day >= v_from and g.source = s.source
          ) c
        ),
        'events', (
          select coalesce(jsonb_object_agg(x.event_name, x.n), '{}'::jsonb)
          from (
            select e.event_name, count(*)::int as n
            from analytics.events e
            join analytics.event_source es on es.event_id = e.id
            where es.source = s.source
              and (e.occurred_at at time zone 'UTC')::date >= v_from
            group by e.event_name
          ) x
        )
      ))
      from (
        values ('friend_group'), ('reddit'), ('meetup'), ('other'), ('skipped'), ('content'), ('unknown')
      ) as s(source)
    ),
    -- The funnel by the campaign tag, and the first plans that have stopped
    -- (SUS-240): one definition, `private.funnel_by_tag`, shared with the
    -- content loop's export (SUS-244, ADR 0087). Every source here.
    'by_source_ref', v_tags -> 'by_source_ref',
    'stalled', v_tags -> 'stalled',
    'events', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'event_name', b.event_name,
          'schema_version', b.schema_version,
          'week', b.week,
          'field', b.field,
          'value', b.value,
          'events', b.events
        ) order by b.event_name, b.week, b.field nulls first, b.value
      ), '[]'::jsonb)
      from analytics.event_breakdown b
      where b.week >= v_from
    )
  );
end;
$$;

comment on function public.founder_analytics(date) is
  'The founder analytics screen''s numbers, from the Monday of p_since''s week, for a user in private.allowlist and nobody else. The allowlist is checked against auth.uid(). Counts and ratios only: no user, anonymous, circle or plan id and no free text.';

revoke all on function public.founder_analytics(date) from public;
revoke all on function public.founder_analytics(date) from anon;
grant execute on function public.founder_analytics(date) to authenticated;
