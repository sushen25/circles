-- ---------------------------------------------------------------------------
-- 0015 — the numbers (S1-21).
--
-- `analytics.events` has been in place since 0006 with nothing writing to it.
-- This migration gives it the one thing the ingest needs — an id per event, so
-- that a client which buffers offline and resends a batch cannot inflate a
-- funnel — and adds the six views the founder actually reads, plus the
-- allowlist that decides who may read them.
--
-- **Where each number comes from is a decision, not a convenience.** Events are
-- the only witness to things that happen before a row exists: a link opened, a
-- session missing, a nudge dismissed. Everything after that is read from the
-- tables, because an event can be lost to an ad-blocker, a crash or a flat
-- battery, and "did this meetup happen" is the one question the product must
-- answer the same way twice. So the top of the funnel is events and the bottom
-- is `meetup_confirmations` and `outcome_reports`.
--
-- Not `jobs.outbox`, ever: retention deletes a processed row after thirty days
-- (0007), so a view over it would quietly stop being able to answer about
-- anything older than a month.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- An id per event.
--
-- Added nullable and backfilled rather than declared not-null in one step, so
-- the migration is the same statement whether or not anything has been ingested
-- yet. `on conflict (event_id) do nothing` in the ingest is what turns a
-- resent batch into a no-op.
-- ---------------------------------------------------------------------------
alter table analytics.events add column event_id uuid;
update analytics.events set event_id = gen_random_uuid() where event_id is null;
alter table analytics.events alter column event_id set not null;
create unique index events_event_id_key on analytics.events (event_id);

comment on column analytics.events.event_id is
  'Minted by whoever recorded the event. The client puts a failed batch back — including when the insert committed and the answer was lost — so this is what makes a resend the same event rather than a second one.';

-- ---------------------------------------------------------------------------
-- Who may read the numbers.
--
-- A table rather than a role, because the answer changes without a deploy and
-- because "the founder" is a person, not a claim in a JWT. Nothing but
-- `analytics.founder_summary()` consults it.
-- ---------------------------------------------------------------------------
create table private.allowlist (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

comment on table private.allowlist is
  'Users who may call analytics.founder_summary(). Empty by default: the numbers are readable by nobody until somebody is put here deliberately.';

alter table private.allowlist enable row level security;

-- ---------------------------------------------------------------------------
-- When a circle became a circle that meets.
--
-- Written once because two views need it and they must not disagree: §11.2's
-- activation ("confirms first meetup within 7 days") is a *rate* — did this
-- circle get going quickly — while the north star's denominator is every
-- circle that has ever got going at all. Both are read from this, so the
-- difference between them stays a deliberate one sentence apart rather than
-- two subqueries that drifted.
--
-- The month is the circle's own, not UTC. A meetup confirmed at 9 am on the
-- first of October in Melbourne is an October meetup, and `date_trunc` on a
-- `timestamptz` would file it under September.
-- ---------------------------------------------------------------------------
create view analytics.circle_activation as
select
  p.circle_id,
  min(mc.confirmed_at) as first_confirmed_at,
  date_trunc('month', min(mc.confirmed_at at time zone c.time_zone)) as activated_month
from public.meetup_confirmations mc
join public.plans p on p.id = mc.plan_id
join public.circles c on c.id = p.circle_id
group by p.circle_id, c.time_zone;

-- ---------------------------------------------------------------------------
-- 1. funnel_by_circle — opens → joins → first response → confirmed → happened.
--
-- The first two stages have no row to count: a link preview impression is
-- unobservable and an open is a browser that may never join (spec §11.2). They
-- come from events, keyed by `circle_id`, which the client attaches because it
-- knows which link was opened. The last three are rows, and are counted from
-- them.
-- ---------------------------------------------------------------------------
create view analytics.funnel_by_circle as
select
  c.id as circle_id,
  c.created_at,
  (select count(*) from analytics.events e
    where e.circle_id = c.id and e.event_name = 'circle_join_opened') as opens,
  (select count(*) from public.circle_members m
    where m.circle_id = c.id and m.status = 'active') as members,
  (select count(distinct r.user_id) from public.plan_responses r
    join public.plans p on p.id = r.plan_id
    where p.circle_id = c.id) as members_who_responded,
  (select count(*) from public.plans p where p.circle_id = c.id) as plans,
  (select count(*) from public.meetup_confirmations mc
    join public.plans p on p.id = mc.plan_id
    where p.circle_id = c.id) as confirmations,
  (select count(*) from public.outcome_reports o
    join public.meetup_confirmations mc on mc.id = o.confirmation_id
    join public.plans p on p.id = mc.plan_id
    where p.circle_id = c.id and o.outcome = 'happened') as happened,
  a.first_confirmed_at,
  -- Activation, as §11.2 defines it: a first meetup confirmed within seven days
  -- of the circle being created. False rather than null for a circle that has
  -- confirmed nothing — `null <= x` is null, and a consumer counting `false`
  -- would miss exactly the circles that did not activate.
  coalesce(a.first_confirmed_at <= c.created_at + interval '7 days', false)
    as activated_within_7_days
from public.circles c
left join analytics.circle_activation a on a.circle_id = c.id;

-- ---------------------------------------------------------------------------
-- 2. plan_timings — how long the two waits actually are.
--
-- Medians rather than averages: one plan that sat for a fortnight would move a
-- mean and tells you nothing about the common case, and the gate in §11.4 is
-- written as a median ("median response after link open under two minutes").
-- ---------------------------------------------------------------------------
create view analytics.plan_timings as
select
  date_trunc('month', p.created_at) as month,
  count(*) as plans,
  percentile_cont(0.5) within group (
    order by extract(epoch from (first_response.at - p.created_at))
  ) as median_seconds_to_first_response,
  percentile_cont(0.5) within group (
    order by extract(epoch from (confirmed.at - p.created_at))
  ) as median_seconds_to_confirmed
from public.plans p
left join lateral (
  select min(r.submitted_at) as at from public.plan_responses r where r.plan_id = p.id
) as first_response on true
left join lateral (
  select min(mc.confirmed_at) as at from public.meetup_confirmations mc where mc.plan_id = p.id
) as confirmed on true
group by 1;

-- ---------------------------------------------------------------------------
-- 3. reattach_rate — returns with no session, and how many of them got back in.
--
-- Both sides from events, and they have to be: `session_missing_on_return` is a
-- browser noticing it has nothing, which leaves no row anywhere. The gate is
-- "at least 80% of returns-without-session reattach without owner help"
-- (§11.4), so the denominator is the noticing and the numerator is the getting
-- back in, by the route they took.
-- ---------------------------------------------------------------------------
create view analytics.reattach_rate as
select
  date_trunc('month', e.occurred_at) as month,
  count(*) filter (where e.event_name = 'session_missing_on_return') as sessions_missing,
  count(*) filter (where e.event_name = 'member_reattached') as reattached,
  count(*) filter (
    where e.event_name = 'member_reattached' and e.properties ->> 'source' = 'list'
  ) as reattached_from_list,
  count(*) filter (
    where e.event_name = 'member_reattached' and e.properties ->> 'source' = 'email'
  ) as reattached_from_email,
  count(*) filter (where e.event_name = 'duplicate_member_removed') as duplicates_removed
from analytics.events e
where e.event_name in
  ('session_missing_on_return', 'member_reattached', 'duplicate_member_removed')
group by 1;

-- ---------------------------------------------------------------------------
-- 4. nudge_conversion — shown, dismissed, tapped, by moment.
--
-- From `nudge_states` rather than from the three `app_nudge_*` events: the
-- table is what the client already writes and what the cap is enforced against,
-- so it cannot disagree with what was actually shown, and it survives an
-- ad-blocker. `answer` is null until somebody acts, which is the third column.
-- ---------------------------------------------------------------------------
create view analytics.nudge_conversion as
select
  n.moment,
  count(*) as shown,
  count(*) filter (where n.answer = 'dismissed') as dismissed,
  count(*) filter (where n.answer = 'tapped') as tapped,
  count(*) filter (where n.answer is null) as unanswered
from public.nudge_states n
group by 1;

-- ---------------------------------------------------------------------------
-- 5. north_star_monthly — reported-happened meetups per activated circle per
--    month, with corroborated shown separately (§11.1).
--
-- "Corroborated" is `was_there` from somebody who is not the reporter, which is
-- `corroborationOf` in the domain said in SQL. A meetup one person reported and
-- nobody else confirms still counts as reported; the two numbers are shown
-- side by side rather than one replacing the other, because the difference
-- between them is the thing worth watching.
--
-- The denominator is `analytics.circle_activation`, counted **on or before**
-- that month: a circle that confirmed its first meetup in March is part of
-- April's denominator too, or the rate would rise every time an old circle went
-- quiet. Note that this is "has ever confirmed", not §11.2's seven-day
-- activation — which `funnel_by_circle` reports, from the same source.
-- ---------------------------------------------------------------------------
create view analytics.north_star_monthly as
with reported as (
  select
    date_trunc('month', o.reported_at at time zone c.time_zone) as month,
    o.confirmation_id,
    o.reported_by
  from public.outcome_reports o
  join public.meetup_confirmations mc on mc.id = o.confirmation_id
  join public.plans p on p.id = mc.plan_id
  join public.circles c on c.id = p.circle_id
  where o.outcome = 'happened'
),
-- Every month from the first activation to this one, so a quiet month reads as
-- a quiet month. A `union` of the months that happen to have rows skips the
-- silence, and the silence is the thing worth seeing.
months as (
  select generate_series(
    (select min(activated_month) from analytics.circle_activation),
    greatest(
      date_trunc('month', now()),
      coalesce((select max(month) from reported), date_trunc('month', now()))
    ),
    interval '1 month'
  ) as month
)
select
  m.month,
  (select count(*) from analytics.circle_activation a where a.activated_month <= m.month)
    as activated_circles,
  (select count(*) from reported r where r.month = m.month) as happened_reported,
  (select count(*) from reported r
    where r.month = m.month
      and exists (
        select 1 from public.attendance a
        where a.confirmation_id = r.confirmation_id
          and a.user_id <> r.reported_by
          and a.status = 'was_there'
      )) as happened_corroborated
from months m
order by m.month;

-- ---------------------------------------------------------------------------
-- 6. chasing — the organiser survey, which is the honest half of the response
--    rate.
--
-- "At least 60% of members respond without one-to-one chasing" (§11.4) cannot
-- be measured from responses: a response chased in the group chat looks exactly
-- like one that arrived by itself. So the organiser is asked at confirmation
-- time, and `meetup_confirmations.chased_answer` is the answer.
-- ---------------------------------------------------------------------------
create view analytics.chasing as
select
  date_trunc('month', mc.confirmed_at at time zone c.time_zone) as month,
  mc.chased_answer,
  count(*) as confirmations
from public.meetup_confirmations mc
join public.plans p on p.id = mc.plan_id
join public.circles c on c.id = p.circle_id
where mc.chased_answer is not null
group by 1, 2;

-- The views are read through `analytics.founder_summary()` and nowhere else.
revoke all on analytics.circle_activation from public, anon, authenticated, service_role;
revoke all on analytics.funnel_by_circle from public, anon, authenticated, service_role;
revoke all on analytics.plan_timings from public, anon, authenticated, service_role;
revoke all on analytics.reattach_rate from public, anon, authenticated, service_role;
revoke all on analytics.nudge_conversion from public, anon, authenticated, service_role;
revoke all on analytics.north_star_monthly from public, anon, authenticated, service_role;
revoke all on analytics.chasing from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- `take_rate_token` learns a cost, and the old arity has to go.
--
-- A default parameter makes a new signature rather than replacing the old one:
-- `create or replace` leaves the four-argument version in place, and a call
-- with four arguments then matches both — "function is not unique", from every
-- caller in the product. Dropped here, before the generated block creates the
-- five-argument one; existing callers bind to it through the default.
-- ---------------------------------------------------------------------------
drop function if exists public.take_rate_token(text, bytea, integer, interval);

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/founder_summary.sql
-- ---------------------------------------------------------------------------
-- The six views, to one pair of eyes.
--
-- The views themselves are owner-only. Nothing in the product reads them: the
-- founder diagnostics screen (S4-06) is the only consumer, and it goes through
-- this function so that "who may read the numbers" is one row in one table
-- rather than a grant on six objects that somebody will widen by accident.
--
-- In `public` rather than in `analytics`, where S1-21 first put it, because
-- PostgREST exposes `public` and nothing else: a definer function in
-- `analytics` granted to `authenticated` is a grant that reads like access and
-- is not — the screen could never call it — and `070_communication_jobs.sql`
-- refuses exactly that shape. The schema is where a caller can reach it; the
-- allowlist is what decides whether they may.
--
-- The allowlist is checked against `auth.uid()`, never against a parameter. A
-- function that takes the user it should authorise is a function that
-- authorises whoever calls it.
--
-- What comes back is aggregates — counts, medians, months. No circle is named
-- and no person appears: `funnel_by_circle` is keyed by circle id, which is
-- what lets a founder ask "which circle stalled" without this function being
-- the thing that says who is in it.
-- ---------------------------------------------------------------------------

create or replace function public.founder_summary()
returns jsonb
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

  return jsonb_build_object(
    'funnel_by_circle', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.funnel_by_circle v),
    'plan_timings', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.plan_timings v),
    'reattach_rate', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.reattach_rate v),
    'nudge_conversion', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.nudge_conversion v),
    'north_star_monthly', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.north_star_monthly v),
    'chasing', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.chasing v)
  );
end;
$$;

comment on function public.founder_summary() is
  'Every analytics view, for a user in private.allowlist and nobody else. The allowlist is checked against auth.uid(); the views themselves are owner-only.';

revoke all on function public.founder_summary() from public;
revoke all on function public.founder_summary() from anon;
grant execute on function public.founder_summary() to authenticated;

-- supabase/sql/functions/public/preview_for_code.sql
-- ---------------------------------------------------------------------------
-- The circle's name, for a link preview, to anybody at all.
--
-- A link pasted into a group chat is fetched by WhatsApp, Messenger, Slack and
-- iMessage before a person taps it, with no session and no cookies, and the
-- card they draw is the first thing everybody in that chat sees. So this is the
-- one function in the product that answers an unauthenticated stranger.
--
-- What it answers is the circle's **name** and nothing else (architecture §9.4:
-- "circle name only. Never member names, dates chosen, or anything from a quiet
-- ask"). Not a signature that could carry more later, either: the return is one
-- `text`, so there is no field for a plan's title to be added to in six months
-- by somebody who did not read this comment. `ogTitle(circleName)` in the
-- domain takes the same care with the same reasoning.
--
-- Quiet asks are the case that makes the rule sharp. A quiet ask exists to hide
-- that somebody wants to organise something; a preview card naming the plan
-- would tell the whole chat, including people who are not in the circle.
--
-- Unknown code and archived circle answer the same as a code that never
-- existed: null. Telling them apart would let somebody walk the short-code
-- space and learn which circles exist.
-- ---------------------------------------------------------------------------

create or replace function public.preview_for_code(p_kind text, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  circle_name text;
begin
  -- `/join` carries its secret in the fragment, which is never sent to a
  -- server, so there is no code to look up and nothing to preview but the
  -- generic card. That is the property, not an oversight: the one link that
  -- grants circle membership cannot be resolved by anything that only saw the
  -- URL, this function included.
  if p_kind not in ('j', 'p') then
    return null;
  end if;

  -- Shape first, so a scan with rubbish never reaches the tables. The
  -- short-code alphabet has no `i`, `l`, `o`, `0` or `1` in it.
  if p_code is null or p_code !~ '^[a-hjkmnp-z2-9]{6,12}$' then
    return null;
  end if;

  -- `/j/<code>` and `/p/<code>` are the same plan seen twice — the link you
  -- paste into the chat and the page it opens (architecture §5) — so both
  -- resolve through `plans.short_code` and both answer with the circle's name.
  select c.name into circle_name
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.short_code = p_code and c.status = 'active';

  return circle_name;
end;
$$;

comment on function public.preview_for_code(text, text) is
  'The circle name behind a plan or invite short code, for a link-preview card, or null. The only function that answers an unauthenticated stranger; it returns a name and has no field anything else could be added to (architecture §9.4).';

revoke all on function public.preview_for_code(text, text) from public;
grant execute on function public.preview_for_code(text, text) to anon, authenticated, service_role;

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
    circle_id, plan_id, properties, occurred_at
  )
  select
    e.event_id, e.event_name, e.schema_version, e.user_id, e.anonymous_id,
    e.circle_id, e.plan_id, coalesce(e.properties, '{}'::jsonb), e.occurred_at
  from jsonb_to_recordset(p_rows) as e (
    event_id uuid,
    event_name text,
    schema_version integer,
    user_id uuid,
    anonymous_id text,
    circle_id uuid,
    plan_id uuid,
    properties jsonb,
    occurred_at timestamptz
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

-- supabase/sql/functions/public/take_rate_token.sql
-- ---------------------------------------------------------------------------
-- One fixed window, one counter, one answer: may this happen?
--
-- The window is derived from the clock rather than stored, so there is no
-- bookkeeping to get wrong and no row to expire before it is read: every caller
-- in the same window computes the same `window_start` and lands on the same row.
--
-- Counting happens whether or not the answer is yes. A refused attempt is still
-- an attempt, and a limiter that only counts successes is one that can be held
-- open indefinitely by failing.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.
-- ---------------------------------------------------------------------------

create or replace function public.take_rate_token(
  p_scope text,
  p_key_hash bytea,
  p_limit integer,
  p_window interval,
  -- What this attempt costs. One for a request; more for a request that carries
  -- many of whatever is being limited — a batch of fifty analytics events is
  -- fifty events, and charging it as one made "six hundred a minute" mean
  -- thirty thousand.
  p_cost integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  seconds double precision := extract(epoch from p_window);
  bucket_start timestamptz;
  taken integer;
begin
  if p_limit < 1 or seconds <= 0 or p_cost < 1 then
    raise exception 'take_rate_token needs a positive limit, window and cost'
      using errcode = 'invalid_parameter_value';
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / seconds) * seconds);

  insert into jobs.rate_counters (scope, key_hash, window_start, count)
  values (p_scope, p_key_hash, bucket_start, p_cost)
  on conflict (scope, key_hash, window_start)
    do update set count = jobs.rate_counters.count + p_cost
  returning count into taken;

  return taken <= p_limit;
end;
$$;

comment on function public.take_rate_token(text, bytea, integer, interval, integer) is
  'Counts an attempt in the current fixed window and says whether it is within the limit — `p_cost` for a request that carries many of whatever is limited. Counts refusals too.';

revoke all on function public.take_rate_token(text, bytea, integer, interval, integer) from public;
revoke all on function public.take_rate_token(text, bytea, integer, interval, integer) from anon, authenticated;
grant execute on function public.take_rate_token(text, bytea, integer, interval, integer) to service_role;

-- END GENERATED: function definitions
