-- 0055_organiser_source
--
-- "How did you hear about Wenna?" at the organiser gate (SUS-171), and the
-- founder funnel read by that answer.
--
-- The question is asked once per account, right after the gate's code is
-- accepted. "Once per account" is state, and the state is a `nudge_states` row
-- for a new moment, `organiser_source`: it says the account *was asked* and
-- nothing about what it answered. The answer is the `organiser_source`
-- analytics event, one of five words (`ORGANISER_SOURCES`), and there is no
-- column on `profiles` or anywhere else a client can read that joins a source to
-- a person (non-negotiable 8).
--
-- What this does:
--
--   * `nudge_states` accepts the moment, which names no plan (as the gate).
--   * `analytics.organiser_source_of`, `analytics.circle_source` and
--     `analytics.event_source`: an account's latest answer, a circle's (its
--     owner's, else `unknown`), and the source an event is counted under (its
--     circle's, else its plan's circle's, else its own account's; none when
--     nobody can place it). Owner-only views like the rest of `analytics`.
--   * `analytics.funnel_counts` and `analytics.gate_second_meetup` gain a
--     trailing `source` column; existing sums over them are unchanged.
--   * `public.founder_analytics` (below, generated) returns `by_source`: per
--     source, the funnel's counters and every event's total. Counts only, as
--     the rest of the answer.
--
-- Not migrated: the circles that exist now have owners who were never asked,
-- so they are `unknown`, and stay so.

alter table public.nudge_states
  drop constraint nudge_states_moment,
  drop constraint nudge_states_plan_shape;

alter table public.nudge_states
  add constraint nudge_states_moment check (moment in (
    'after_attendance_start_circle', 'email_given_app', 'locked_in_app', 'organiser_gate',
    'organiser_source', 'reattached_save_place', 'reattached_twice_app', 'second_response_app',
    'sent_save_access'
  )),
  -- A `case`, so a null does not pass (SUS-24).
  add constraint nudge_states_plan_shape check (
    case moment
      when 'organiser_gate' then plan_id is null
      when 'organiser_source' then plan_id is null
      else plan_id is not null
    end
  );

comment on column public.nudge_states.moment is
  'NUDGE_MOMENTS in packages/domain/src/growth. Every moment but organiser_gate and organiser_source names a plan.';

-- ---------------------------------------------------------------------------
-- Where an account, a circle and an event are counted from.
-- ---------------------------------------------------------------------------
create view analytics.organiser_source_of as
select distinct on (e.user_id)
  e.user_id,
  e.properties ->> 'source' as source
from analytics.events e
where e.event_name = 'organiser_source' and e.user_id is not null
order by e.user_id, e.occurred_at desc;

create view analytics.circle_source as
select c.id as circle_id, coalesce(os.source, 'unknown') as source
from public.circles c
left join analytics.organiser_source_of os on os.user_id = c.owner_user_id;

create view analytics.event_source as
select e.id as event_id,
  coalesce(
    (select cs.source from analytics.circle_source cs where cs.circle_id = e.circle_id),
    (select cs.source from public.plans p
       join analytics.circle_source cs on cs.circle_id = p.circle_id
      where p.id = e.plan_id),
    (select os.source from analytics.organiser_source_of os where os.user_id = e.user_id)
  ) as source
from analytics.events e;

comment on view analytics.organiser_source_of is
  'An account''s latest answer to "How did you hear about Wenna?". Never returned: only counted, by founder_analytics.';
comment on view analytics.circle_source is
  'Every circle and its owner''s answer, or unknown when the owner was never asked.';
comment on view analytics.event_source is
  'Every event and the source it is counted under: its circle''s, else its plan''s circle''s, else its own account''s; null when nobody can place it.';

revoke all on analytics.organiser_source_of from public, anon, authenticated, service_role;
revoke all on analytics.circle_source from public, anon, authenticated, service_role;
revoke all on analytics.event_source from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The funnel's row counts, by source (last column, so the views are replaced in
-- place and keep their grants).
-- ---------------------------------------------------------------------------
create or replace view analytics.funnel_counts as
select 'circles_created'::text as counter, c.created_at::date as day, count(*) as n, cs.source
from public.circles c
join analytics.circle_source cs on cs.circle_id = c.id
group by 2, 4
union all
select 'circles_activated', c.created_at::date, count(*), cs.source
from public.circles c
join analytics.circle_activation a on a.circle_id = c.id and a.within_7_days
join analytics.circle_source cs on cs.circle_id = c.id
group by 2, 4
union all
-- A member's first answer in a circle, once (see 0043).
select 'answers', f.first_at::date, count(*), cs.source
from (
  select p.circle_id, r.user_id, min(r.created_at) as first_at
  from public.plan_responses r
  join public.plans p on p.id = r.plan_id
  join public.circles c on c.id = p.circle_id
  where r.user_id <> c.owner_user_id
  group by p.circle_id, r.user_id
) f
join analytics.circle_source cs on cs.circle_id = f.circle_id
group by 2, 4
union all
select 'plans_created', p.created_at::date, count(*), cs.source
from public.plans p
join analytics.circle_source cs on cs.circle_id = p.circle_id
group by 2, 4
union all
select 'plans_confirmed', f.first_at::date, count(*), cs.source
from (
  select mc.plan_id, min(mc.confirmed_at) as first_at
  from public.meetup_confirmations mc
  group by mc.plan_id
) f
join public.plans p on p.id = f.plan_id
join analytics.circle_source cs on cs.circle_id = p.circle_id
group by 2, 4
union all
select 'reported_happened', o.reported_at::date, count(distinct o.confirmation_id), cs.source
from public.outcome_reports o
join public.meetup_confirmations mc on mc.id = o.confirmation_id
join public.plans p on p.id = mc.plan_id
join analytics.circle_source cs on cs.circle_id = p.circle_id
where o.outcome = 'happened'
group by 2, 4
union all
select 'corroborated', o.reported_at::date, count(distinct o.confirmation_id), cs.source
from public.outcome_reports o
join public.meetup_confirmations mc on mc.id = o.confirmation_id
join public.plans p on p.id = mc.plan_id
join analytics.circle_source cs on cs.circle_id = p.circle_id
where o.outcome = 'happened'
  and exists (
    select 1 from public.attendance a
    where a.confirmation_id = o.confirmation_id
      and a.user_id <> o.reported_by
      and a.status = 'was_there'
  )
group by 2, 4;

create or replace view analytics.gate_second_meetup as
with firsts as (
  select p.circle_id, min(mc.confirmed_at) as first_confirmed_at
  from public.meetup_confirmations mc
  join public.plans p on p.id = mc.plan_id
  group by p.circle_id
),
seconds as (
  select f.circle_id, min(p.created_at) as started_at
  from firsts f
  join public.plans p on p.circle_id = f.circle_id and p.created_at > f.first_confirmed_at
  group by f.circle_id
)
select s.started_at::date as day, count(*) as circles, cc.cohort, cs.source
from seconds s
join analytics.circle_cohort cc on cc.circle_id = s.circle_id
join analytics.circle_source cs on cs.circle_id = s.circle_id
group by 1, cc.cohort, cs.source;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/founder_analytics.sql
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
        values ('friend_group'), ('reddit'), ('meetup'), ('other'), ('skipped'), ('unknown')
      ) as s(source)
    ),
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

-- END GENERATED: function definitions
