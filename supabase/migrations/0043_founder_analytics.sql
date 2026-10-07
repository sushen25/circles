-- 0043_founder_analytics
--
-- The founder's analytics screen (SUS-166): the north star, the funnel, the
-- decision gates against their targets, and every feature's adoption from its
-- own events, as one answer to one person on the allowlist.
--
-- What this adds:
--
--   * `analytics.event_breakdown`: per event name, schema version and ISO
--     week, the count, and for every payload key whose value is a boolean or a
--     short enum word, the count per value. **The rule is here and not in the
--     client**: a key that names an identifier, a value that is not a boolean
--     or a short lower-case word, and a field with too many different values
--     to be an enum never leave this view. The quiet ask's unattributed events
--     are totals and nothing else.
--   * Views for the decision gates (spec §11.4) that no view computed: each is
--     a day and the two numbers a gate is a ratio of. No identifier is a
--     column of any of them.
--   * `public.founder_analytics(p_since date)`: the same allowlist, checked the
--     same way against `auth.uid()`, returning all of it as one object from
--     the Monday of the week `p_since` falls in. `public.founder_summary()` is
--     left as it is: it answers a different question (every month, every
--     circle's funnel row) and nothing here replaces it.
--
-- Nothing in a table changes, and no grant on a view is added: the views are
-- owner-only like the six before them, and the function is the only way in.

-- ---------------------------------------------------------------------------
-- 1. event_breakdown — every event, by week, and by value where a value is a
--    boolean or an enum word.
--
-- The week is ISO (Monday), in UTC: an event has no circle to take a zone from.
--
-- What is let through, and why each condition is here:
--
--   * `circle_id`, `plan_id` and anything else that is an identifier is a key
--     the catalogue lets a payload carry (`identifiers` in analytics.ts), and a
--     breakdown by one is a breakdown by circle or by plan.
--   * `build`, `route`, `reference`, `token` and (outside the one event whose
--     `code` is an enum) `code` are strings that are not enums; the build
--     is a commit hash and the reference is what a person reads out. Neither is
--     an enum, and a lower-case hash would otherwise pass the shape test below.
--   * The shape test: a boolean, or a string of lower-case letters and
--     underscores, at most 24 long. Every enum in the catalogue fits it. A
--     number is not a category, and a sentence, an address, an id or a token
--     does not fit it. (The table already refuses a content key, and a string
--     value of more than 40 characters of anything but a code; this is the
--     second wall.)
--   * A field with more than twelve distinct values over all time is not an
--     enum, whatever the values look like: that is what a field made of ids
--     written in letters would look like.
--   * The two unattributed events (`UNATTRIBUTED_EVENTS` in analytics.ts) are
--     totals only, whatever a row of them carries. They are bare by their
--     schema; this keeps it so if one ever were not.
-- ---------------------------------------------------------------------------
create view analytics.event_breakdown as
with usable as (
  select
    e.event_name,
    e.schema_version,
    date_trunc('week', e.occurred_at at time zone 'UTC')::date as week,
    kv.key as field,
    kv.value #>> '{}' as value
  from analytics.events e
  cross join lateral jsonb_each(e.properties) kv
  where e.event_name not in ('quiet_ask_created', 'quiet_interest_answered')
    and kv.key !~ '(^|_)id$'
    and kv.key not in ('build', 'route', 'reference', 'token')
    -- A `code` is a short code in a link or an emailed one unless the catalogue
    -- says it is an enum: `email_delivery_result`'s is, the one place it is.
    and (kv.key <> 'code' or e.event_name = 'email_delivery_result')
    and (
      jsonb_typeof(kv.value) = 'boolean'
      or (jsonb_typeof(kv.value) = 'string' and (kv.value #>> '{}') ~ '^[a-z][a-z_]{0,23}$')
    )
),
enums as (
  select event_name, field
  from usable
  group by event_name, field
  having count(distinct value) <= 12
)
select
  e.event_name,
  e.schema_version,
  date_trunc('week', e.occurred_at at time zone 'UTC')::date as week,
  null::text as field,
  null::text as value,
  count(*) as events
from analytics.events e
group by 1, 2, 3
union all
select
  u.event_name,
  u.schema_version,
  u.week,
  u.field,
  u.value,
  count(*) as events
from usable u
join enums using (event_name, field)
group by 1, 2, 3, 4, 5;

comment on view analytics.event_breakdown is
  'Per event, schema version and ISO week: the count (field and value null), and per boolean or enum-word payload key, the count per value. Identifiers, free text and anything that is not an enum are excluded here, in SQL.';

-- ---------------------------------------------------------------------------
-- 2. The gates (spec §11.4) that no view computed.
--
-- Each is a day and the two counts a gate is a ratio of, so a period is a sum
-- over days and nothing is a median of medians. No view has an identifier as a
-- column; where a person or a circle is needed to join, it is joined and
-- dropped.
-- ---------------------------------------------------------------------------

-- "Every test circle confirms at least one real meetup." Day: the circle's
-- creation, in UTC.
create view analytics.gate_circles_confirm as
select
  c.created_at::date as day,
  count(*) as circles,
  count(*) filter (where a.circle_id is not null) as confirmed
from public.circles c
left join analytics.circle_activation a on a.circle_id = c.id
group by 1;

-- "At least 60% of members respond without one-to-one chasing (survey)": the
-- organiser's answer at confirmation (`chased_answer`), turned into members. The
-- denominator is the members the plan asked (`plan_participants`), whether or not
-- they answered. The numerator is those who answered and were not chased: `none`
-- is every one who answered; `one` is all but one of them; `more` ("several", and
-- the survey cannot say how many) counts as all of them chased. So the share is a
-- floor: a gate read "met" off it is met, and one read "not met" may be better
-- than it looks. Day: the confirmation.
create view analytics.gate_unchased as
select
  mc.confirmed_at::date as day,
  sum(r.members)::bigint as members,
  sum(
    case mc.chased_answer
      when 'none' then r.responders
      when 'one' then greatest(r.responders - 1, 0)
      else 0
    end
  )::bigint as unchased
from public.meetup_confirmations mc
cross join lateral (
  select
    (select count(*) from public.plan_participants pp
      where pp.plan_id = mc.plan_id and pp.revision = mc.revision) as members,
    (select count(*) from public.plan_responses pr
      where pr.plan_id = mc.plan_id and pr.revision = mc.revision) as responders
) r
where mc.chased_answer is not null
group by 1;

-- "Median response after link open": one row per answer that has an open
-- before it, with the wait. Day and seconds only: no person, no plan. It reads
-- as `plan_timings` does, and for the same reasons (the first answer, and the
-- latest open before it).
create view analytics.open_to_response as
select
  r.created_at::date as day,
  extract(epoch from (r.created_at - o.opened_at)) as seconds
from public.plan_responses r
cross join lateral (
  select max(e.occurred_at) as opened_at
  from analytics.events e
  where e.plan_id = r.plan_id
    and e.user_id = r.user_id
    and e.event_name in ('circle_join_opened', 'availability_started')
    and e.occurred_at <= r.created_at
) o
where o.opened_at is not null;

-- "At least 70% of confirmed meetups reported happened": the meetups that were
-- not moved or called off, and those reported as not having happened, once they
-- are over. Day: when it was to start.
create view analytics.gate_happened as
select
  mc.starts_at::date as day,
  count(*) as meetups,
  count(*) filter (
    where exists (
      select 1 from public.outcome_reports o
      where o.confirmation_id = mc.id and o.outcome = 'happened'
    )
  ) as happened
from public.meetup_confirmations mc
where mc.ends_at < now()
  -- Moved outside the app is "neither failure nor success" (spec §9): it is in
  -- neither number.
  and not exists (
    select 1 from public.outcome_reports o
    where o.confirmation_id = mc.id and o.outcome = 'moved_outside'
  )
  and (
    mc.status in ('active', 'completed')
    -- A meetup the organiser then reported as cancelled is closed by that report
    -- (`apply_outcome`), and it is exactly the failure this gate counts. A time
    -- that was moved or called off before it came is not.
    or exists (select 1 from public.outcome_reports o where o.confirmation_id = mc.id)
  )
group by 1;

-- "At least 80% of returns-without-session reattach without owner help":
-- noticing there is no session, and getting back in from the list on the same
-- screen (`source = 'list'`), which is the path a return with no session takes
-- and where `session_missing_on_return` is recorded. The emailed-link route
-- (`source = 'email'`) starts from a letter, not from a return, so it is in
-- neither half. Neither route involves the owner. The two halves are counted and
-- not matched (a browser with no session has no identity to match on), so a
-- reattachment by somebody who still had a session counts too: the share can
-- only overstate, and the screen says so.
create view analytics.gate_reattach as
select
  e.occurred_at::date as day,
  count(*) filter (where e.event_name = 'session_missing_on_return') as missing,
  count(*) filter (
    where e.event_name = 'member_reattached' and e.properties ->> 'source' = 'list'
  ) as reattached
from analytics.events e
where e.event_name in ('session_missing_on_return', 'member_reattached')
group by 1;

-- "At least one group initiates a second meetup": a circle that started
-- another plan after its first meetup was confirmed. Day: that plan's creation.
create view analytics.gate_second_meetup as
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
select s.started_at::date as day, count(*) as circles
from seconds s
group by 1;

-- "At least one non-usual organiser starts a plan or quiet ask": a plan
-- somebody other than the circle's owner, the usual organiser, started. Who
-- *started* a named plan is not who organises it now (a hand-off moves the
-- organiser), so it is read from the creation itself: the outbox event's
-- organiser at that moment (kept 30 days) or the `plan_created` event's user
-- (kept, but sent by a client that can be blocked); either is evidence. A quiet
-- ask counts once somebody has taken the role (the organiser is public from
-- then, ADR 0041); who started it is exactly what stays in `private`.
create view analytics.gate_other_organiser as
select p.created_at::date as day, count(*) as plans
from public.plans p
join public.circles c on c.id = p.circle_id
where (
    p.mode = 'named'
    and (
      exists (
        select 1 from jobs.outbox o
        where o.aggregate_id = p.id
          and o.event_name = 'planning.plan_created'
          and (o.payload ->> 'organiser_user_id')::uuid <> c.owner_user_id
      )
      or exists (
        select 1 from analytics.events e
        where e.plan_id = p.id
          and e.event_name = 'plan_created'
          and e.user_id is not null
          and e.user_id <> c.owner_user_id
      )
    )
  )
  or (p.mode = 'quiet' and p.organiser_user_id is not null and p.organiser_user_id <> c.owner_user_id)
group by 1;

-- "At least half of guests who submit an email verify it": a guest, here, is
-- the user id or, without a session, the browser id on the event. Only a
-- submission that says which route it took counts (`save_place` present): a
-- saved member's one button says nothing and has nothing to verify. Verified is
-- the same one confirming afterwards, by the emailed link (`email_verified`) or,
-- on the save-my-place route, by typing the code back (`account_claimed`). A
-- confirmation on another device is not matched, so the share is a floor and
-- never a ceiling. (So is one that signs in to an existing account: the claim
-- is then that account's id, not the guest's.) Day: the submission.
create view analytics.gate_email_verified as
with submitted as (
  select coalesce(e.user_id::text, e.anonymous_id) as actor, min(e.occurred_at) as at
  from analytics.events e
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
  ) as verified
from submitted s
group by 1;

-- External cohort. "At least 50% of activated circles confirm within seven
-- days": of the circles old enough to have had the seven days, those that did.
-- Day: the circle's creation.
create view analytics.gate_confirm_in_week as
select
  c.created_at::date as day,
  count(*) as circles,
  count(*) filter (where coalesce(a.within_7_days, false)) as confirmed_in_week
from public.circles c
left join analytics.circle_activation a on a.circle_id = c.id
where c.created_at < now() - interval '7 days'
group by 1;

-- "At least 30% of successful circles initiate another within cadence": a
-- circle with a cadence whose first meetup reported as happened, once that
-- cadence (in the circle's own zone, as the scheduler counts it) has run its course, and whether a plan was made after the
-- confirmation and by then. Day: when the meetup was to start.
create view analytics.gate_another_in_cadence as
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
  ) as another
from first_happened f
where f.due_by < now()
group by 1;

-- "Conversions to saved place ... arrive at value moments rather than only at
-- the organiser gate": claims, and those not at the gate. Day: the claim.
create view analytics.gate_claim_moments as
select
  e.occurred_at::date as day,
  count(*) as claims,
  count(*) filter (where e.properties ->> 'moment' <> 'organiser_gate') as elsewhere
from analytics.events e
where e.event_name = 'account_claimed'
group by 1;

-- The funnel's counts that are rows and not events, by the day they happened.
create view analytics.funnel_counts as
select 'circles_created'::text as counter, c.created_at::date as day, count(*) as n
from public.circles c group by 2
union all
select 'circles_activated', c.created_at::date, count(*)
from public.circles c
join analytics.circle_activation a on a.circle_id = c.id and a.within_7_days
group by 2
union all
-- A member's first answer in a circle, once: "join-link opens → joins → first
-- response" (§11.2). Counting every answer would let one person who answers two
-- plans be two first responses.
select 'answers', f.first_at::date, count(*)
from (
  select p.circle_id, r.user_id, min(r.created_at) as first_at
  from public.plan_responses r
  join public.plans p on p.id = r.plan_id
  group by p.circle_id, r.user_id
) f
group by 2
union all
select 'plans_created', p.created_at::date, count(*)
from public.plans p group by 2
union all
-- A plan on the day it was first confirmed, once: one reopened and confirmed
-- again on another day is still one plan decided.
select 'plans_confirmed', f.first_at::date, count(*)
from (
  select mc.plan_id, min(mc.confirmed_at) as first_at
  from public.meetup_confirmations mc
  group by mc.plan_id
) f
group by 2
union all
select 'reported_happened', o.reported_at::date, count(distinct o.confirmation_id)
from public.outcome_reports o where o.outcome = 'happened' group by 2
union all
select 'corroborated', o.reported_at::date, count(distinct o.confirmation_id)
from public.outcome_reports o
where o.outcome = 'happened'
  and exists (
    select 1 from public.attendance a
    where a.confirmation_id = o.confirmation_id
      and a.user_id <> o.reported_by
      and a.status = 'was_there'
  )
group by 2;

revoke all on analytics.event_breakdown from public, anon, authenticated, service_role;
revoke all on analytics.gate_circles_confirm from public, anon, authenticated, service_role;
revoke all on analytics.gate_unchased from public, anon, authenticated, service_role;
revoke all on analytics.open_to_response from public, anon, authenticated, service_role;
revoke all on analytics.gate_happened from public, anon, authenticated, service_role;
revoke all on analytics.gate_reattach from public, anon, authenticated, service_role;
revoke all on analytics.gate_second_meetup from public, anon, authenticated, service_role;
revoke all on analytics.gate_other_organiser from public, anon, authenticated, service_role;
revoke all on analytics.gate_email_verified from public, anon, authenticated, service_role;
revoke all on analytics.gate_confirm_in_week from public, anon, authenticated, service_role;
revoke all on analytics.gate_another_in_cadence from public, anon, authenticated, service_role;
revoke all on analytics.gate_claim_moments from public, anon, authenticated, service_role;
revoke all on analytics.funnel_counts from public, anon, authenticated, service_role;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/founder_analytics.sql
-- ---------------------------------------------------------------------------
-- The founder's analytics screen, to one pair of eyes (SUS-166).
--
-- The north star, the decision gates' two numbers each, the funnel's row
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
    'gates', jsonb_build_object(
      'confirmed_meetup', (
        select jsonb_build_object(
          'numerator', coalesce(sum(confirmed), 0)::int, 'denominator', coalesce(sum(circles), 0)::int)
        from analytics.gate_circles_confirm where day >= v_from),
      'unchased', (
        select jsonb_build_object(
          'numerator', coalesce(sum(unchased), 0)::int, 'denominator', coalesce(sum(members), 0)::int)
        from analytics.gate_unchased where day >= v_from),
      'response_time', (
        select jsonb_build_object(
          'median_seconds', percentile_cont(0.5) within group (order by seconds), 'n', count(*)::int)
        from analytics.open_to_response where day >= v_from),
      'happened', (
        select jsonb_build_object(
          'numerator', coalesce(sum(happened), 0)::int, 'denominator', coalesce(sum(meetups), 0)::int)
        from analytics.gate_happened where day >= v_from),
      'reattach', (
        select jsonb_build_object(
          'numerator', coalesce(sum(reattached), 0)::int, 'denominator', coalesce(sum(missing), 0)::int)
        from analytics.gate_reattach where day >= v_from),
      'second_meetup', (
        select jsonb_build_object('count', coalesce(sum(circles), 0)::int)
        from analytics.gate_second_meetup where day >= v_from),
      'other_organiser', (
        select jsonb_build_object('count', coalesce(sum(plans), 0)::int)
        from analytics.gate_other_organiser where day >= v_from),
      'email_verified', (
        select jsonb_build_object(
          'numerator', coalesce(sum(verified), 0)::int, 'denominator', coalesce(sum(submitted), 0)::int)
        from analytics.gate_email_verified where day >= v_from),
      'confirm_in_week', (
        select jsonb_build_object(
          'numerator', coalesce(sum(confirmed_in_week), 0)::int, 'denominator', coalesce(sum(circles), 0)::int)
        from analytics.gate_confirm_in_week where day >= v_from),
      'another_in_cadence', (
        select jsonb_build_object(
          'numerator', coalesce(sum(another), 0)::int, 'denominator', coalesce(sum(successful), 0)::int)
        from analytics.gate_another_in_cadence where day >= v_from),
      'claim_moments', (
        select jsonb_build_object(
          'numerator', coalesce(sum(elsewhere), 0)::int, 'denominator', coalesce(sum(claims), 0)::int)
        from analytics.gate_claim_moments where day >= v_from)
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

-- END GENERATED: function definitions
