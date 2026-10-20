-- 0072_source_ref_and_stalled_first_plans
--
-- A stranger's path from a post to a first plan is observable (SUS-240, parts 1
-- and 2): the campaign tag a link carried, and the first plans that have
-- stopped.
--
-- Part 1, the tag. A link we post carries `?from=<tag>` (`^[a-z0-9-]{1,40}$`).
-- When the organiser passes the gate the circle is made and tagged, and the tag
-- is written to that circle's row in `private.circle_cohorts`, the founder-only
-- mapping of ADR 0058, as `source_ref`. It is a label for the post and never
-- for the person: no client role can read the table, `tag_circle_source`
-- returns nothing, and the tag is in no event, log line or email.
--
--   * `private.circle_cohorts.source_ref`, with the slug rule as a check.
--   * `public.tag_circle_source` (below, generated): the owner tags their own
--     circle, once.
--   * `analytics.circle_source_ref` and `analytics.event_source_ref`: a
--     circle's tag, and the tag an event is counted under (its circle's, else
--     its plan's circle's). Owner-only views like the rest of `analytics`.
--   * `analytics.funnel_counts` gains a trailing `source_ref` column;
--     existing sums over it are unchanged.
--
-- Part 2, the stalled first plans. `analytics.stalled_first_plans` is, per
-- circle, its first named plan when that plan is one of three kinds of stopped:
--
--   * `not_shared`: made more than 24 hours ago and no sign it reached anyone;
--   * `shared_quiet`: shared, and nobody else has answered 48 hours on;
--   * `answered_short`: somebody else answered, the reply deadline has passed
--     and fewer people can come than the quorum.
--
-- It is computed from product tables (SUS-213): plans, circle members and
-- responses. The one fact with no row is whether the organiser opened the share
-- sheet ("the app records that the share sheet opened", spec §5.3), which is the
-- `plan_shared` event. A person who joined or answered shows the plan was shared
-- whatever the event says, so a lost event can only make a plan read as unshared
-- for as long as nobody has come. The view returns ages in hours and no name,
-- circle id or plan code; `founder_analytics` (below, generated) groups it.
--
-- No new storage beyond the one column: the rest are views.

-- ---------------------------------------------------------------------------
-- Part 1.
-- ---------------------------------------------------------------------------
alter table private.circle_cohorts
  add column source_ref text,
  add constraint circle_cohorts_source_ref check (source_ref ~ '^[a-z0-9-]{1,40}$');

comment on column private.circle_cohorts.source_ref is
  'The campaign tag (?from=) the circle''s organiser arrived on: a slug, a label for a post and never for a person. Written once by tag_circle_source; founder-read only, with the rest of this table (SUS-240).';

create view analytics.circle_source_ref as
select cc.circle_id, cc.source_ref
from private.circle_cohorts cc
where cc.source_ref is not null;

create view analytics.event_source_ref as
select e.id as event_id,
  coalesce(
    (select r.source_ref from analytics.circle_source_ref r where r.circle_id = e.circle_id),
    (select r.source_ref from public.plans p
       join analytics.circle_source_ref r on r.circle_id = p.circle_id
      where p.id = e.plan_id)
  ) as source_ref
from analytics.events e;

comment on view analytics.circle_source_ref is
  'Every tagged circle and its campaign tag. Never returned: only counted, by founder_analytics.';
comment on view analytics.event_source_ref is
  'Every event and the campaign tag it is counted under: its circle''s, else its plan''s circle''s; null when untagged or when nobody can place it.';

revoke all on analytics.circle_source_ref from public, anon, authenticated, service_role;
revoke all on analytics.event_source_ref from public, anon, authenticated, service_role;

-- The funnel's row counts, by tag as well (last column, so the view is replaced
-- in place and keeps its grants).
create or replace view analytics.funnel_counts as
select 'circles_created'::text as counter, c.created_at::date as day, count(*) as n, cs.source, csr.source_ref
from public.circles c
join analytics.circle_source cs on cs.circle_id = c.id
left join analytics.circle_source_ref csr on csr.circle_id = c.id
group by 2, 4, 5
union all
select 'circles_activated', c.created_at::date, count(*), cs.source, csr.source_ref
from public.circles c
join analytics.circle_activation a on a.circle_id = c.id and a.within_7_days
join analytics.circle_source cs on cs.circle_id = c.id
left join analytics.circle_source_ref csr on csr.circle_id = c.id
group by 2, 4, 5
union all
-- A member's first answer in a circle, once (see 0043).
select 'answers', f.first_at::date, count(*), cs.source, csr.source_ref
from (
  select p.circle_id, r.user_id, min(r.created_at) as first_at
  from public.plan_responses r
  join public.plans p on p.id = r.plan_id
  join public.circles c on c.id = p.circle_id
  where r.user_id <> c.owner_user_id
  group by p.circle_id, r.user_id
) f
join analytics.circle_source cs on cs.circle_id = f.circle_id
left join analytics.circle_source_ref csr on csr.circle_id = f.circle_id
group by 2, 4, 5
union all
select 'plans_created', p.created_at::date, count(*), cs.source, csr.source_ref
from public.plans p
join analytics.circle_source cs on cs.circle_id = p.circle_id
left join analytics.circle_source_ref csr on csr.circle_id = p.circle_id
group by 2, 4, 5
union all
select 'plans_confirmed', f.first_at::date, count(*), cs.source, csr.source_ref
from (
  select mc.plan_id, min(mc.confirmed_at) as first_at
  from public.meetup_confirmations mc
  group by mc.plan_id
) f
join public.plans p on p.id = f.plan_id
join analytics.circle_source cs on cs.circle_id = p.circle_id
left join analytics.circle_source_ref csr on csr.circle_id = p.circle_id
group by 2, 4, 5
union all
select 'reported_happened', o.reported_at::date, count(distinct o.confirmation_id), cs.source, csr.source_ref
from public.outcome_reports o
join public.meetup_confirmations mc on mc.id = o.confirmation_id
join public.plans p on p.id = mc.plan_id
join analytics.circle_source cs on cs.circle_id = p.circle_id
left join analytics.circle_source_ref csr on csr.circle_id = p.circle_id
where o.outcome = 'happened'
group by 2, 4, 5
union all
select 'corroborated', o.reported_at::date, count(distinct o.confirmation_id), cs.source, csr.source_ref
from public.outcome_reports o
join public.meetup_confirmations mc on mc.id = o.confirmation_id
join public.plans p on p.id = mc.plan_id
join analytics.circle_source cs on cs.circle_id = p.circle_id
left join analytics.circle_source_ref csr on csr.circle_id = p.circle_id
where o.outcome = 'happened'
  and exists (
    select 1 from public.attendance a
    where a.confirmation_id = o.confirmation_id
      and a.user_id <> o.reported_by
      and a.status = 'was_there'
  )
group by 2, 4, 5;

-- ---------------------------------------------------------------------------
-- Part 2.
-- ---------------------------------------------------------------------------
create view analytics.stalled_first_plans as
with firsts as (
  select distinct on (p.circle_id)
    p.id, p.circle_id, p.state, p.revision, p.quorum, p.created_at, p.response_deadline
  from public.plans p
  where p.mode = 'named'
  order by p.circle_id, p.created_at, p.id
),
facts as (
  select
    f.*,
    c.created_at as circle_created_at,
    (select min(e.occurred_at) from analytics.events e
      where e.plan_id = f.id and e.event_name = 'plan_shared') as shared_event_at,
    -- Somebody other than the owner who has answered, on any revision.
    (select count(distinct r.user_id) from public.plan_responses r
      where r.plan_id = f.id and r.user_id <> c.owner_user_id)::int as others_answered,
    -- Who can come on the plan as it stands: the owner counts, as the quorum does.
    (select count(distinct r.user_id) from public.plan_responses r
      where r.plan_id = f.id and r.revision = f.revision
        and r.status in ('windows', 'flexible'))::int as can_come,
    exists (
      select 1 from public.circle_members m
      where m.circle_id = f.circle_id and m.user_id <> c.owner_user_id and m.status = 'active'
    ) as someone_joined
  from firsts f
  join public.circles c on c.id = f.circle_id
  -- Still asking: a plan that was confirmed, cancelled or has run out has not
  -- stalled, it has ended.
  where f.state in ('collecting', 'ready')
),
judged as (
  select
    f.*,
    (f.shared_event_at is not null or f.someone_joined or f.others_answered > 0) as shared
  from facts f
)
select
  date_trunc('week', j.circle_created_at)::date as week,
  cc.cohort,
  cs.source,
  k.state,
  k.age_hours
from judged j
join analytics.circle_cohort cc on cc.circle_id = j.circle_id
join analytics.circle_source cs on cs.circle_id = j.circle_id
cross join lateral (
  select state, age_hours from (
    select
      case
        when j.others_answered > 0 and j.response_deadline <= now() and j.can_come < j.quorum
          then 'answered_short'
        when j.others_answered = 0 and j.shared
             and now() - coalesce(j.shared_event_at, j.created_at) >= interval '48 hours'
          then 'shared_quiet'
        when not j.shared and now() - j.created_at >= interval '24 hours'
          then 'not_shared'
      end as state,
      extract(epoch from (
        now() - case
          when j.others_answered > 0 then j.response_deadline
          when j.shared then coalesce(j.shared_event_at, j.created_at)
          else j.created_at
        end
      )) / 3600.0 as age_hours
  ) x
  where state is not null
) k;

comment on view analytics.stalled_first_plans is
  'Each circle''s first named plan while it is still asking, when it has stopped: not_shared (24 h, no sign it reached anyone), shared_quiet (48 h, nobody else has answered) or answered_short (past the deadline and short of the quorum). One row per such circle, with the Monday of the week the circle began, its cohort and source, and the age in hours. No circle, plan or person is named. Never returned: only counted, by founder_analytics.';

revoke all on analytics.stalled_first_plans from public, anon, authenticated, service_role;

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
        values ('friend_group'), ('reddit'), ('meetup'), ('other'), ('skipped'), ('content'), ('unknown')
      ) as s(source)
    ),
    -- The funnel by the campaign tag (SUS-240). The tags seen in the period, the
    -- forty busiest at most; per tag, the row counters and a few events' totals.
    -- A tag is a slug the founder chose for a post, and nothing names the person
    -- who followed it.
    'by_source_ref', (
      select coalesce(jsonb_object_agg(r.source_ref, jsonb_build_object(
        'counters', (
          select coalesce(jsonb_object_agg(c.counter, c.n), '{}'::jsonb)
          from (
            select f.counter, sum(f.n)::int as n
            from analytics.funnel_counts f
            where f.day >= v_from and f.source_ref = r.source_ref
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
              and (e.occurred_at at time zone 'UTC')::date >= v_from
            group by e.event_name
          ) x
        )
      )), '{}'::jsonb)
      from (
        select f.source_ref
        from analytics.funnel_counts f
        where f.day >= v_from and f.source_ref is not null
        group by f.source_ref
        order by sum(f.n) desc, f.source_ref
        limit 40
      ) r
    ),
    -- First plans that have stopped (SUS-240): by the Monday of the week the
    -- circle began, its cohort, the source and the state; counts and ages only.
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
        where week >= v_from
        group by week, cohort, source, state
      ) s
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

-- supabase/sql/functions/public/tag_circle_source.sql
-- ---------------------------------------------------------------------------
-- tag_circle_source
--
-- The campaign tag a circle's organiser arrived on (`?from=<tag>`, SUS-240),
-- written to that circle's founder-only cohort row as `source_ref`.
--
-- **A label for the post, never for the person.** The tag goes on
-- `private.circle_cohorts`, which no client role can read (ADR 0058): not on
-- `circles`, not on a profile, not beside a name or an address, and in no
-- event, log line or email. This function returns nothing, so tagging a circle
-- does not read one either.
--
-- **Only the owner of the circle may tag it, and only once.** The owner is
-- found by `auth.uid()` through `auth_is_owner`, as the other owner-only
-- writes find them; a caller who is not the owner, an unknown circle and an
-- anonymous session all get the same `circle_not_found`. A circle that already
-- has a tag keeps it: the first one is the post the organiser came from, and a
-- later call (a retry, a second tab) says nothing different.
--
-- **A tag that is not a slug is dropped, not refused** (`^[a-z0-9-]{1,40}$`,
-- `parseSourceRef` in `packages/domain`): a label must never be the reason a
-- circle is not made, and the column's check constraint is the last word.
-- ---------------------------------------------------------------------------
create or replace function public.tag_circle_source(p_circle_id uuid, p_source_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.auth_is_owner(p_circle_id) then
    raise exception 'circle_not_found' using errcode = 'P0002';
  end if;

  if p_source_ref is null or p_source_ref !~ '^[a-z0-9-]{1,40}$' then
    return;
  end if;

  update private.circle_cohorts cc
  set source_ref = p_source_ref
  where cc.circle_id = p_circle_id and cc.source_ref is null;
end;
$$;

comment on function public.tag_circle_source(uuid, text) is
  'Records the campaign tag a circle''s organiser arrived on, on the founder-only cohort row, once. Owner only. A tag that is not a slug is ignored. Returns nothing: a tag is never read back to a client.';

revoke all on function public.tag_circle_source(uuid, text) from public;
revoke all on function public.tag_circle_source(uuid, text) from anon;
grant execute on function public.tag_circle_source(uuid, text) to authenticated;

-- END GENERATED: function definitions
