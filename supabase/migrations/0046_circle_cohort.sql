-- 0046_circle_cohort
--
-- Every circle carries a cohort (SUS-178, ADR 0058), so the founder dashboard
-- counts the decision gates of spec §11.4 for the founder cohort and for the
-- external cohort separately instead of pooling the external cohort's over every
-- circle.
--
-- Spec §11.4, which defines the two cohorts:
--
--   Founder cohort (qualitative targets): every test circle confirms at least
--   one real meetup; ... External cohort: at least 50% of activated circles
--   confirm within seven days; ...
--
-- Shape: a mapping table in `private`, not a column on `circles`. `circles` is
-- readable by every member and is what `create_circle`, circle lists and the
-- generated client types return; a column there is one `select *` from being
-- shown, and "never readable by a user" would hold only for as long as every
-- query remembered it. A row in `private` has no path to a client at all (the
-- same reason `private.plan_initiators` exists).
--
-- What this does:
--
--   * `private.circle_cohorts`: one row per circle, `founder` or `external`,
--     how it got there (`default` by the rule, or `founder` by hand) and when.
--   * `private.assign_circle_cohort` (below, generated) is an insert trigger on
--     `circles`: the owner is on `private.allowlist` -> `founder`, else
--     `external`.
--   * Backfill, by the same rule, for every circle that exists now.
--   * `public.founder_set_circle_cohort` (below, generated): the founder
--     corrects a cohort. Same allowlist as `founder_analytics`; no UI.
--   * `analytics.circle_cohort` and `analytics.event_cohort`, and every gate
--     view gains a `cohort` column; `public.founder_analytics` (below,
--     generated) returns each gate once per cohort.
--
-- Events with no circle: an event carries a circle or plan only when its
-- payload named one. Where it has neither, its cohort is the one of the person's
-- circles: `founder` if they belong to any founder circle, else `external` if
-- they belong to any circle. An event nobody can place (no circle, no plan, no
-- user, or a user in no circle) is in neither cohort.

-- ---------------------------------------------------------------------------
-- 1. The mapping.
-- ---------------------------------------------------------------------------
create table private.circle_cohorts (
  circle_id uuid primary key references public.circles (id) on delete cascade,
  cohort text not null,
  source text not null default 'default',
  set_at timestamptz not null default now(),
  constraint circle_cohorts_cohort check (cohort in ('founder', 'external')),
  constraint circle_cohorts_source check (source in ('default', 'founder'))
);

comment on table private.circle_cohorts is
  'Which spec §11.4 cohort a circle is counted in: founder or external. Set by the owner-on-allowlist rule at creation (source default) or by the founder (source founder). Never selectable by a client, never in an event payload, never shown in the product (ADR 0058).';

alter table private.circle_cohorts enable row level security;
revoke all on private.circle_cohorts from public, anon, authenticated, service_role;

-- Backfill by the same rule as the trigger. The counts are in the notice, so a
-- migration run says how many circles landed where.
do $$
declare
  n_founder integer;
  n_external integer;
begin
  insert into private.circle_cohorts (circle_id, cohort)
  select c.id,
         case when exists (select 1 from private.allowlist a where a.user_id = c.owner_user_id)
              then 'founder' else 'external' end
  from public.circles c;

  select count(*) filter (where cohort = 'founder'), count(*) filter (where cohort = 'external')
  into n_founder, n_external
  from private.circle_cohorts;
  raise notice '0046 backfill: % founder, % external', n_founder, n_external;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Where a circle, and an event, is counted.
-- ---------------------------------------------------------------------------
create view analytics.circle_cohort as
select c.id as circle_id, coalesce(cc.cohort, 'external') as cohort
from public.circles c
left join private.circle_cohorts cc on cc.circle_id = c.id;

create view analytics.event_cohort as
select e.id as event_id,
  coalesce(
    (select cc.cohort from analytics.circle_cohort cc where cc.circle_id = e.circle_id),
    (select cc.cohort from public.plans p
       join analytics.circle_cohort cc on cc.circle_id = p.circle_id
      where p.id = e.plan_id),
    (select case when bool_or(cc.cohort = 'founder') then 'founder' else 'external' end
       from public.circle_members m
       join analytics.circle_cohort cc on cc.circle_id = m.circle_id
      where m.user_id = e.user_id
      having count(*) > 0)
  ) as cohort
from analytics.events e;

comment on view analytics.circle_cohort is
  'Every circle and its cohort; a circle with no row counts as external.';
comment on view analytics.event_cohort is
  'Every event and the cohort it is counted in: its circle''s, else its plan''s circle''s, else founder when its user belongs to any founder circle and external when they belong to any other; null when nobody can place it.';

-- ---------------------------------------------------------------------------
-- 3. The gate views, each with a cohort column (last, so the view is replaced
--    in place and keeps its grants).
-- ---------------------------------------------------------------------------
create or replace view analytics.gate_circles_confirm as
select
  c.created_at::date as day,
  count(*) as circles,
  count(*) filter (where a.circle_id is not null) as confirmed,
  cc.cohort
from public.circles c
join analytics.circle_cohort cc on cc.circle_id = c.id
left join analytics.circle_activation a on a.circle_id = c.id
group by 1, cc.cohort;

create or replace view analytics.gate_unchased as
select
  mc.confirmed_at::date as day,
  sum(r.members)::bigint as members,
  sum(
    case mc.chased_answer
      when 'none' then r.responders
      when 'one' then greatest(r.responders - 1, 0)
      else 0
    end
  )::bigint as unchased,
  cc.cohort
from (
  select distinct on (c.plan_id, c.revision) c.*
  from public.meetup_confirmations c
  where c.chased_answer is not null
  order by c.plan_id, c.revision, c.confirmed_at desc
) mc
join public.plans pl on pl.id = mc.plan_id
join analytics.circle_cohort cc on cc.circle_id = pl.circle_id
cross join lateral (
  select
    (select count(*) from public.plan_participants pp
      where pp.plan_id = mc.plan_id and pp.revision = mc.revision) as members,
    (select count(*) from public.plan_responses pr
      where pr.plan_id = mc.plan_id and pr.revision = mc.revision) as responders
) r
where mc.chased_answer is not null
group by 1, cc.cohort;

create or replace view analytics.open_to_response as
select
  r.created_at::date as day,
  extract(epoch from (r.created_at - o.opened_at)) as seconds,
  cc.cohort
from public.plan_responses r
join public.plans pl on pl.id = r.plan_id
join analytics.circle_cohort cc on cc.circle_id = pl.circle_id
cross join lateral (
  select max(e.occurred_at) as opened_at
  from analytics.events e
  where e.plan_id = r.plan_id
    and e.user_id = r.user_id
    and e.event_name in ('circle_join_opened', 'availability_started')
    and e.occurred_at <= r.created_at
) o
where o.opened_at is not null;

create or replace view analytics.gate_happened as
select
  mc.starts_at::date as day,
  count(*) as meetups,
  count(*) filter (
    where exists (
      select 1 from public.outcome_reports o
      where o.confirmation_id = mc.id and o.outcome = 'happened'
    )
  ) as happened,
  cc.cohort
from public.meetup_confirmations mc
join public.plans pl on pl.id = mc.plan_id
join analytics.circle_cohort cc on cc.circle_id = pl.circle_id
where mc.ends_at < now()
  and not exists (
    select 1 from public.outcome_reports o
    where o.confirmation_id = mc.id and o.outcome = 'moved_outside'
  )
  and (
    mc.status in ('active', 'completed')
    or exists (select 1 from public.outcome_reports o where o.confirmation_id = mc.id)
  )
group by 1, cc.cohort;

create or replace view analytics.gate_reattach as
select
  e.occurred_at::date as day,
  count(*) filter (where e.event_name = 'session_missing_on_return') as missing,
  count(*) filter (
    where e.event_name = 'member_reattached' and e.properties ->> 'source' = 'list'
  ) as reattached,
  ec.cohort
from analytics.events e
join analytics.event_cohort ec on ec.event_id = e.id
where e.event_name in ('session_missing_on_return', 'member_reattached')
group by 1, ec.cohort;

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
select s.started_at::date as day, count(*) as circles, cc.cohort
from seconds s
join analytics.circle_cohort cc on cc.circle_id = s.circle_id
group by 1, cc.cohort;

-- Same rule as 0045: who started a named plan is its `plan.created` audit row.
create or replace view analytics.gate_other_organiser as
select p.created_at::date as day, count(*) as plans, cc.cohort
from public.plans p
join public.circles c on c.id = p.circle_id
join analytics.circle_cohort cc on cc.circle_id = c.id
where p.mode = 'named'
  and exists (
    select 1 from private.audit_log a
    where a.action = 'plan.created'
      and a.resource_type = 'plan'
      and a.resource_id = p.id
      and a.actor_user_id is not null
      and a.actor_user_id <> c.owner_user_id
  )
group by 1, cc.cohort;

-- A guest's cohort is the cohort of their first submission.
create or replace view analytics.gate_email_verified as
with submitted as (
  select coalesce(e.user_id::text, e.anonymous_id) as actor,
         min(e.occurred_at) as at,
         (array_agg(ec.cohort order by e.occurred_at))[1] as cohort
  from analytics.events e
  join analytics.event_cohort ec on ec.event_id = e.id
  where e.event_name = 'email_submitted'
    and e.properties ? 'save_place'
    and coalesce(e.user_id::text, e.anonymous_id) is not null
  group by 1
),
verified as (
  select coalesce(e.user_id::text, e.anonymous_id) as actor, e.occurred_at as at
  from analytics.events e
  where e.event_name in ('email_verified', 'account_claimed')
    and coalesce(e.user_id::text, e.anonymous_id) is not null
)
select
  s.at::date as day,
  count(*) as submitted,
  count(*) filter (
    where exists (select 1 from verified v where v.actor = s.actor and v.at >= s.at)
  ) as verified,
  s.cohort
from submitted s
group by 1, s.cohort;

create or replace view analytics.gate_confirm_in_week as
select
  c.created_at::date as day,
  count(*) as circles,
  count(*) filter (where coalesce(a.within_7_days, false)) as confirmed_in_week,
  cc.cohort
from public.circles c
join analytics.circle_cohort cc on cc.circle_id = c.id
left join analytics.circle_activation a on a.circle_id = c.id
where c.created_at < now() - interval '7 days'
group by 1, cc.cohort;

create or replace view analytics.gate_another_in_cadence as
with first_happened as (
  select distinct on (p.circle_id)
    p.circle_id,
    mc.confirmed_at,
    mc.starts_at,
    case c.cadence
      when 'weekly' then ((mc.starts_at at time zone c.time_zone) + interval '7 days') at time zone c.time_zone
      when 'fortnightly' then ((mc.starts_at at time zone c.time_zone) + interval '14 days') at time zone c.time_zone
      when 'monthly' then ((mc.starts_at at time zone c.time_zone) + interval '1 month') at time zone c.time_zone
      when 'two_monthly' then ((mc.starts_at at time zone c.time_zone) + interval '2 months') at time zone c.time_zone
    end as due_by
  from public.outcome_reports o
  join public.meetup_confirmations mc on mc.id = o.confirmation_id
  join public.plans p on p.id = mc.plan_id
  join public.circles c on c.id = p.circle_id
  where o.outcome = 'happened' and c.cadence <> 'none'
  order by p.circle_id, mc.starts_at
)
select
  f.starts_at::date as day,
  count(*) as successful,
  count(*) filter (
    where exists (
      select 1 from public.plans p2
      where p2.circle_id = f.circle_id
        and p2.created_at > f.confirmed_at
        and p2.created_at <= f.due_by
    )
  ) as another,
  cc.cohort
from first_happened f
join analytics.circle_cohort cc on cc.circle_id = f.circle_id
where f.due_by < now()
group by 1, cc.cohort;

create or replace view analytics.gate_claim_moments as
select
  e.occurred_at::date as day,
  count(*) as claims,
  count(*) filter (where e.properties ->> 'moment' <> 'organiser_gate') as elsewhere,
  ec.cohort
from analytics.events e
join analytics.event_cohort ec on ec.event_id = e.id
where e.event_name = 'account_claimed'
group by 1, ec.cohort;

revoke all on analytics.circle_cohort from public, anon, authenticated, service_role;
revoke all on analytics.event_cohort from public, anon, authenticated, service_role;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/private/assign_circle_cohort.sql
-- ---------------------------------------------------------------------------
-- Which cohort a new circle belongs to (SUS-178, ADR 0058).
--
-- Spec §11.4 judges the founder's test circles and the external cohort against
-- different gates, so every circle carries a cohort and nobody but the founder
-- can read or change it. The rule at creation: a circle whose owner is on the
-- founder allowlist (`private.allowlist`, the one `founder_analytics` checks) is
-- `founder`; every other circle is `external`. Run as the owner, because
-- neither table is reachable by the user who is creating the circle.
--
-- A trigger on `circles` rather than a line in `create_circle`, so a circle
-- made any other way (the seed, a restore, a future writer) cannot be left
-- without one.
-- ---------------------------------------------------------------------------
create or replace function private.assign_circle_cohort()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.circle_cohorts (circle_id, cohort)
  values (
    new.id,
    case
      when exists (select 1 from private.allowlist a where a.user_id = new.owner_user_id)
        then 'founder'
      else 'external'
    end
  )
  on conflict (circle_id) do nothing;
  return new;
end;
$$;

revoke all on function private.assign_circle_cohort() from public;
revoke all on function private.assign_circle_cohort() from anon, authenticated;

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
              'numerator', coalesce(sum(unchased), 0)::int, 'denominator', coalesce(sum(members), 0)::int)
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

-- supabase/sql/functions/public/founder_set_circle_cohort.sql
-- ---------------------------------------------------------------------------
-- The founder sets a circle's cohort (SUS-178, ADR 0058).
--
-- Spec §11.4 splits the decision gates into the founder cohort's and the
-- external cohort's. A circle starts in the cohort its owner's allowlist
-- membership says (`private.assign_circle_cohort`); this is how the founder
-- corrects it, for a test circle owned by a friend or one made before the
-- founder was on the allowlist.
--
-- **The same allowlist as `founder_analytics`, checked against `auth.uid()`,
-- never a parameter.** Everybody else, `anon` included, is refused with
-- `insufficient_privilege` before the circle is even looked at. Nothing in the
-- product calls this and nothing returns the cohort to a client: the answer is
-- void, so setting a cohort does not read one.
-- ---------------------------------------------------------------------------
create or replace function public.founder_set_circle_cohort(p_circle_id uuid, p_cohort text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not exists (
    select 1 from private.allowlist a where a.user_id = caller
  ) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;

  if p_cohort is null or p_cohort not in ('founder', 'external') then
    raise exception 'invalid_cohort' using errcode = '22023';
  end if;

  update private.circle_cohorts
  set cohort = p_cohort, source = 'founder', set_at = now()
  where circle_id = p_circle_id;

  if not found then
    raise exception 'circle_not_found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.founder_set_circle_cohort(uuid, text) is
  'Sets a circle''s cohort (founder or external) for a user in private.allowlist and nobody else. The allowlist is checked against auth.uid(). Returns nothing: a cohort is never read back to a client.';

revoke all on function public.founder_set_circle_cohort(uuid, text) from public;
revoke all on function public.founder_set_circle_cohort(uuid, text) from anon;
grant execute on function public.founder_set_circle_cohort(uuid, text) to authenticated;

-- END GENERATED: function definitions

-- The trigger goes after the function it runs, which the generated block above
-- defines.
create trigger circles_assign_cohort
  after insert on public.circles
  for each row execute function private.assign_circle_cohort();
