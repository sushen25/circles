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

-- ---------------------------------------------------------------------------
-- The two privacy rules the ingest follows, as constraints.
--
-- AGENTS.md says the privacy invariants are "structural, not procedural — the
-- code and the database make them impossible, not someone remembering", and
-- until now both of these lived only in `track-events`. The table already
-- refuses a payload carrying words (`events_properties_carry_no_content`) "for
-- the day the ingest has a bug"; these are the same argument for the column
-- beside it.
-- ---------------------------------------------------------------------------
alter table analytics.events
  add constraint events_anonymous_id_is_digest
    check (anonymous_id is null or anonymous_id ~ '^[0-9a-f]{64}$'),
  -- A row carrying both is a join from everything a browser did before signing
  -- in to the account it signed in to.
  add constraint events_identity_is_one_or_the_other
    check (user_id is null or anonymous_id is null);

-- The lookup `plan_timings` does once per response — this member's last open
-- before this answer — and the one `move_membership` does when somebody comes
-- back on a new device. Neither is served by the indexes 0006 created
-- (`(event_name, occurred_at)`, `(circle_id, occurred_at)`), so both were
-- reading every event ever recorded and filtering afterwards: measured at 300k
-- events, the founder summary took 152 ms and the identity move 18 ms inside a
-- transaction holding `circle_members` locked. With this, 0.3 ms.
create index events_user_plan_time_idx on analytics.events (user_id, plan_id, occurred_at);

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
-- Written once because two views need it and they must not disagree. §11.2 is
-- the definition: "Activation — circle confirms first meetup within 7 days",
-- and §11.1's "per activated circle" is that same word. An earlier draft of
-- this view let the north star count every circle that had ever confirmed, on
-- the reasoning that a slow circle is still a live one — which is a change to a
-- product rule, and those go through an ADR rather than through a denominator.
--
-- The month is the circle's own, not UTC. A meetup confirmed at 9 am on the
-- first of October in Melbourne is an October meetup, and `date_trunc` on a
-- `timestamptz` would file it under September.
-- ---------------------------------------------------------------------------
create view analytics.circle_activation as
select
  p.circle_id,
  min(mc.confirmed_at) as first_confirmed_at,
  date_trunc('month', min(mc.confirmed_at at time zone c.time_zone)) as activated_month,
  min(mc.confirmed_at) <= min(c.created_at) + interval '7 days' as within_7_days
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
  -- Two different things, because they were one and it was wrong. `joins` is
  -- the funnel stage — "join-link opens → joins" (§11.2) — and comes from the
  -- events, so it counts what happened and keeps counting it after somebody
  -- leaves. `active_members` is the roster as it stands, which includes the
  -- owner, who created the circle rather than joining it.
  (select count(*) from analytics.events e
    where e.circle_id = c.id and e.event_name = 'circle_joined') as joins,
  (select count(*) from public.circle_members m
    where m.circle_id = c.id and m.status = 'active') as active_members,
  (select count(distinct r.user_id) from public.plan_responses r
    join public.plans p on p.id = r.plan_id
    where p.circle_id = c.id) as members_who_responded,
  (select count(*) from public.plans p where p.circle_id = c.id) as plans,
  -- Distinct *plans*, because a plan reopened and re-confirmed twice is one
  -- meetup decided three times, and this stage is "plan creation →
  -- confirmation" (§11.2). Without it, `confirmations` can exceed `plans`.
  (select count(distinct mc.plan_id) from public.meetup_confirmations mc
    join public.plans p on p.id = mc.plan_id
    where p.circle_id = c.id) as confirmations,
  (select count(*) from public.outcome_reports o
    join public.meetup_confirmations mc on mc.id = o.confirmation_id
    join public.plans p on p.id = mc.plan_id
    where p.circle_id = c.id and o.outcome = 'happened') as happened,
  a.first_confirmed_at,
  -- False rather than null for a circle that has confirmed nothing — `null <=
  -- x` is null, and a consumer counting `false` would miss exactly the circles
  -- that did not activate.
  coalesce(a.within_7_days, false) as activated_within_7_days
from public.circles c
left join analytics.circle_activation a on a.circle_id = c.id;

-- ---------------------------------------------------------------------------
-- 2. plan_timings — how long the waits actually are.
--
-- Medians rather than averages: one plan that sat for a fortnight would move a
-- mean and tells you nothing about the common case, and the gate in §11.4 is
-- written as a median.
--
-- **Two different waits, because §11.4 names one and the organiser feels the
-- other.** "Median response after link open, under two minutes" is the
-- member's: they tap, they answer, and the organiser planning the night before
-- is nothing to do with it. That one needs an event, because a row exists only
-- once somebody answers and the tap that preceded it leaves nothing behind —
-- so it is null until the client is emitting. The waits measured from the plan
-- are the organiser's own and are always available.
-- ---------------------------------------------------------------------------
create view analytics.plan_timings as
-- **`created_at`, not `submitted_at`.** A member may change their answer, and
-- `replace_response` moves `submitted_at` when they do (`on conflict … do
-- update set submitted_at = excluded.submitted_at`). So somebody who answered
-- in thirty seconds and edited a window the next day was reported as having
-- taken a day, which would have made the §11.4 gate unmeasurable in exactly the
-- circles that used the product most. `created_at` is only ever set by the
-- insert, so it is when they first answered — which is what every one of these
-- numbers is about.
with answers as (
  select
    r.plan_id,
    r.user_id,
    r.created_at as answered_at,
    -- When this person last opened the link before answering. The open is on
    -- the client's clock and the answer on the server's, so a phone a few
    -- seconds fast loses its match and drops out of the median — the figure is
    -- a good one to compare month over month and not one to read as exact to
    -- the second. §11.4's gate is
    -- "median response after link open", and the wait a member experiences
    -- starts when they tap — not when the organiser made the plan, which may
    -- have been the night before.
    (select max(e.occurred_at)
     from analytics.events e
     where e.plan_id = r.plan_id
       and e.user_id = r.user_id
       and e.event_name in ('circle_join_opened', 'availability_started')
       and e.occurred_at <= r.created_at) as opened_at
  from public.plan_responses r
),
per_plan as (
  select
    p.id as plan_id,
    date_trunc('month', p.created_at at time zone c.time_zone) as month,
    p.created_at,
    (select min(r.created_at) from public.plan_responses r where r.plan_id = p.id) as first_at,
    -- §11.2 asks for first, median *and* last: "time to first/median/last
    -- response". The last one is the wait the organiser actually sits through,
    -- and the median is the one that says whether the group is with them.
    -- `percentile_disc` rather than `percentile_cont`: there is no halfway
    -- point between two instants, and the middle answer is a real one somebody
    -- actually gave.
    (select percentile_disc(0.5) within group (order by r.created_at)
     from public.plan_responses r where r.plan_id = p.id) as median_at,
    (select max(r.created_at) from public.plan_responses r where r.plan_id = p.id) as last_at,
    (select min(mc.confirmed_at) from public.meetup_confirmations mc
     where mc.plan_id = p.id) as confirmed_at
  from public.plans p
  join public.circles c on c.id = p.circle_id
)
select
  pp.month,
  count(*) as plans,
  -- Over **every** answer, not the first one per plan. Taking one response a
  -- plan made this the median of first responders, which is the fastest person
  -- in each group and not the number the gate is about: ten seconds and ten
  -- minutes reported ten seconds.
  (select percentile_cont(0.5) within group (
     order by extract(epoch from (a.answered_at - a.opened_at)))
   from answers a
   join per_plan inner_plan on inner_plan.plan_id = a.plan_id
   where inner_plan.month = pp.month and a.opened_at is not null
  ) as median_seconds_from_open_to_response,
  -- And the waits measured from the plan, which exist even for a member whose
  -- open was never recorded.
  percentile_cont(0.5) within group (
    order by extract(epoch from (pp.first_at - pp.created_at))
  ) as median_seconds_to_first_response,
  percentile_cont(0.5) within group (
    order by extract(epoch from (pp.median_at - pp.created_at))
  ) as median_seconds_to_median_response,
  percentile_cont(0.5) within group (
    order by extract(epoch from (pp.last_at - pp.created_at))
  ) as median_seconds_to_last_response,
  percentile_cont(0.5) within group (
    order by extract(epoch from (pp.confirmed_at - pp.created_at))
  ) as median_seconds_to_confirmed
from per_plan pp
group by pp.month;

-- ---------------------------------------------------------------------------
-- 3. reattach_rate — returns with no session, and how many of them got back in.
--
-- The one view bucketed in UTC, because it is the one with no circle to take a
-- zone from: `session_missing_on_return` is a browser noticing it has nothing,
-- before it knows which circle it was going to. A month boundary is hours wide
-- and this is a ratio read month over month, so UTC is honest here in a way it
-- would not be for a count of meetups.
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
-- The denominator is the circles §11.2 calls activated — first meetup confirmed
-- within seven days — counted **on or before** that month: one that activated
-- in March is part of April's denominator too, or the rate would rise every
-- time an old circle went quiet.
--
-- The numerator is restricted to the same circles, which is the half that is
-- easy to get wrong: counting every circle's meetups over a denominator of
-- activated ones would report a rate no circle actually achieves.
-- ---------------------------------------------------------------------------
create view analytics.north_star_monthly as
with activated as (
  select * from analytics.circle_activation where within_7_days
),
reported as (
  select
    -- The month the meetup **happened**, not the month somebody got round to
    -- saying so. A Saturday-night catch-up reported on Sunday the first was
    -- counting against the wrong month, and "meetups per circle per month"
    -- (§11.1) is a question about evenings rather than about paperwork.
    date_trunc('month', mc.starts_at at time zone c.time_zone) as month,
    o.confirmation_id,
    o.reported_by
  from public.outcome_reports o
  join public.meetup_confirmations mc on mc.id = o.confirmation_id
  join public.plans p on p.id = mc.plan_id
  join public.circles c on c.id = p.circle_id
  join activated a on a.circle_id = p.circle_id
  where o.outcome = 'happened'
),
-- Every month from the first activation to this one, so a quiet month reads as
-- a quiet month. A `union` of the months that happen to have rows skips the
-- silence, and the silence is the thing worth seeing.
months as (
  -- Cast, because `greatest` with a `timestamptz` would coerce the whole
  -- series and hand this one view a `month` of a different type from every
  -- other — which a reader of `founder_summary` would have to special-case.
  select generate_series(
    (select min(activated_month) from activated),
    greatest(
      date_trunc('month', now() at time zone 'UTC'),
      coalesce((select max(month) from reported), date_trunc('month', now() at time zone 'UTC'))
    ),
    interval '1 month'
  )::timestamp as month
)
select
  m.month,
  (select count(*) from activated a where a.activated_month <= m.month) as activated_circles,
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

-- supabase/sql/functions/private/adopt_membership_rows.sql
-- ---------------------------------------------------------------------------
-- The same person, twice in one circle, and only one row may survive.
--
-- `claim_identity` meets this when somebody joined from two devices under two
-- names (spec §9) and then saves their place: both identities are active members,
-- the saved place is the one that keeps working, and the guest row goes.
--
-- But "the guest row goes" must not mean "what the guest did goes". Answers,
-- attendance, participation, being required, an interest answer — each is
-- something this person actually did, and `on_member_removed` deletes or neutralises
-- them when the membership is removed (spec §4.5). So everything the survivor does
-- *not already have* is adopted first, and only what is genuinely duplicated is
-- left to be cleaned up.
--
-- The counterpart of `private.move_membership`, and the difference is the whole
-- point: that one moves rows unconditionally, because the destination has no
-- membership to collide with. This one moves only into the gaps.
--
-- The address is reconciled too, through the same `private.reconcile_contacts`
-- the move path uses. Leaving the duplicate's contact behind was the first
-- version of this, on the reasoning that a removed membership is ineligible for
-- notification anyway — but it also leaves any emailed `/a/<token>` link bound to
-- a membership that no longer exists, and an email already sent is not ours to
-- break (spec §5.1).
-- ---------------------------------------------------------------------------

create or replace function private.adopt_membership_rows(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The inputs are not changing, only whose they are — see `bump_input_version`.
  -- Local to the transaction, so it cannot leak into anything else.
  perform set_config('circles.moving_membership', 'on', true);

  -- Participation first: `enforce_attendance_transition` refuses an attendance
  -- row whose owner is not a participant of the confirmation's revision, so
  -- adopting attendance before participation would raise and take the whole
  -- claim with it.
  update public.plan_participants pp
  set user_id = p_to
  where pp.user_id = p_from
    and pp.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.plan_participants kept
      where kept.plan_id = pp.plan_id and kept.revision = pp.revision and kept.user_id = p_to
    );

  update public.plan_responses r
  set user_id = p_to
  where r.user_id = p_from
    and r.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.plan_responses kept
      where kept.plan_id = r.plan_id and kept.revision = r.revision and kept.user_id = p_to
    );

  -- The organiser's decision that *this person* has to be there.
  -- `on_member_removed` leaves this table alone on purpose — spec §9 makes a
  -- required person leaving the organiser's problem to resolve — but nobody is
  -- leaving here, so the requirement follows them. Otherwise an active plan would
  -- go on requiring an identity that can no longer answer.
  update public.plan_required_members rm
  set user_id = p_to
  where rm.user_id = p_from
    and rm.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.plan_required_members kept
      where kept.plan_id = rm.plan_id and kept.revision = rm.revision and kept.user_id = p_to
    );

  update public.attendance a
  set user_id = p_to
  where a.user_id = p_from
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans pl on pl.id = c.plan_id
      where pl.circle_id = p_circle_id
    )
    and not exists (
      select 1 from public.attendance kept
      where kept.confirmation_id = a.confirmation_id and kept.user_id = p_to
    )
    -- And only where the revision knows the survivor, which the participation
    -- update above has just made true wherever it can be.
    and exists (
      select 1 from public.plan_participants pp
      join public.meetup_confirmations c on c.id = a.confirmation_id
      where pp.plan_id = c.plan_id and pp.revision = c.revision and pp.user_id = p_to
    );

  -- A quiet ask's interest answer. Two rows for one person would count them
  -- twice towards the threshold, which is the one number the quiet ask turns on.
  update private.plan_interest i
  set user_id = p_to
  where i.user_id = p_from
    and i.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from private.plan_interest kept
      where kept.plan_id = i.plan_id and kept.user_id = p_to
    );

  -- Prompts already shown, so the survivor is not shown them again.
  update public.nudge_states n
  set user_id = p_to
  where n.user_id = p_from
    and n.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.nudge_states kept
      where kept.user_id = p_to and kept.moment = n.moment
        and kept.plan_id is not distinct from n.plan_id
    );

  -- And the measurements, which follow the person like everything else here.
  -- No `not exists` guard: an event is a record of a moment rather than a row
  -- one identity may hold once, so two of them surviving a merge is two things
  -- that happened, which is the truth. (`analytics.events` has no foreign key
  -- to `auth.users` — an event outlives what it was about — so it is easy to
  -- miss when reading for tables that point at an identity.)
  update analytics.events e set user_id = p_to
  where e.user_id = p_from
    and (
      e.circle_id = p_circle_id
      or e.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    );

  perform private.reconcile_contacts(p_circle_id, p_from, p_to);
  perform set_config('circles.moving_membership', 'off', true);
end;
$$;

comment on function private.adopt_membership_rows(uuid, uuid, uuid) is
  'Moves a duplicate membership''s rows onto the surviving one, but only where the survivor has none. The gap-filling counterpart of move_membership.';

revoke all on function private.adopt_membership_rows(uuid, uuid, uuid) from public;
revoke all on function private.adopt_membership_rows(uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/private/move_membership.sql
-- ---------------------------------------------------------------------------
-- One membership, one circle, from one identity to another.
--
-- Both paths that move a membership use this: `reattach_member`, when a guest
-- comes back with no session (ADR 0006), and `claim_identity`, when somebody
-- saves their place and turns out to have had a permanent identity already.
-- One copy, because the cost of two is a table moved by one of them and left
-- behind by the other — and "left behind" means a guest who reattaches and
-- finds their answers gone.
--
-- It decides nothing. Who may move what is the caller's question: this assumes
-- it has already been answered and does the writing.
--
-- `member_dayparts` and any re-entry token for the membership are absent below
-- because they move themselves — both reference `circle_members` with
-- `on update cascade`, which 0006 and 0007 put there for this moment.
--
-- `analytics.events` **is** here, and it took a review round to see why. It has
-- no foreign key to `auth.users` — an event outlives the row it was about — so
-- it is invisible to the guard in `095_identity_merge.sql` that catches a table
-- this function forgot. The argument for leaving it alone was that an event
-- records what happened to an identity at a time; the argument that wins is
-- that `plan_timings` joins a member's link-open to their answer on `user_id`,
-- and leaving the event behind broke that join for everybody who came back on a
-- new device — measuring §11.4's gate over exactly the people who did not.
-- ---------------------------------------------------------------------------

create or replace function private.move_membership(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The inputs are not changing, only whose they are — see `bump_input_version`.
  -- Local to the transaction, so it cannot leak into anything else.
  perform set_config('circles.moving_membership', 'on', true);

  -- Outstanding emailed links first, while `membership_user_id` still names the
  -- identity they were issued against: the write below cascades that column, and
  -- `enforce_reentry_for_guests` fires on it. `private.retire_reentry_links` says
  -- what happens and why, and `reconcile_contacts` calls it too — the
  -- duplicate-merge path reaches the same tokens by a different route.
  perform private.retire_reentry_links(p_circle_id, p_from, p_to);

  -- The membership itself, first: the cascading references follow this write.
  update public.circle_members m
  set user_id = p_to
  where m.circle_id = p_circle_id and m.user_id = p_from;

  -- Everything else the member owns. Each of these references `auth.users`
  -- with no action on update, so each is moved by name — and
  -- `090_identity_continuity.sql` checks the list against the catalogue rather
  -- than trusting that it is complete.
  update public.plan_responses r set user_id = p_to
  where r.user_id = p_from
    and r.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_participants pp set user_id = p_to
  where pp.user_id = p_from
    and pp.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_required_members rm set user_id = p_to
  where rm.user_id = p_from
    and rm.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.attendance a set user_id = p_to
  where a.user_id = p_from
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where p.circle_id = p_circle_id
    );

  update public.nudge_states n set user_id = p_to
  where n.user_id = p_from
    and n.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update private.plan_interest i set user_id = p_to
  where i.user_id = p_from
    and i.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The measurements follow the person too, which is easy to miss because this
  -- is the one table here with no foreign key to `auth.users` — an event
  -- outlives the row it was about, so it deliberately holds ids rather than
  -- references. `plan_timings` matches a member's link-open event to their
  -- answer on `user_id`, and leaving the event behind broke that join the
  -- moment somebody reattached: their open-to-response wait vanished from
  -- §11.4's gate, and yesterday's figure changed today. The gate would have
  -- been measured over exactly the members who never came back on a new device.
  update analytics.events e set user_id = p_to
  where e.user_id = p_from
    and (
      e.circle_id = p_circle_id
      or e.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id)
    );

  -- The availability snapshots name who could come, and `transition_plan` reads
  -- the candidate's array at confirm time to decide who is `going`. A stale id
  -- there is this person marked `unknown` at the one moment the product is
  -- about.
  update public.candidates c
  set available_user_ids = array_replace(c.available_user_ids, p_from, p_to)
  where p_from = any (c.available_user_ids)
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  -- And the one id a near-miss carries. `{"kind":"required_missing","userId":…}`
  -- is the single rule the no-quorum screen shows — "the closest near-misses,
  -- the blocking rule, and three actions" (spec §5.6) — and it names somebody
  -- who is *not* available, so the array above never touches it. Left behind, it
  -- would name an identity that has just stopped being a member, and the screen
  -- would blame a person who is not there for a plan the person who *is* there
  -- is blocking.
  update public.candidates c
  set near_miss_reason = jsonb_set(c.near_miss_reason, '{userId}', to_jsonb(p_to::text))
  where c.near_miss_reason ->> 'kind' = 'required_missing'
    and c.near_miss_reason ->> 'userId' = p_from::text
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  update public.meetup_confirmations mc
  set available_user_ids = array_replace(mc.available_user_ids, p_from, p_to)
  where p_from = any (mc.available_user_ids)
    and mc.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The address this membership is reachable at, and everything hanging off it.
  -- In `private.reconcile_contacts`, shared with `adopt_membership_rows`, because
  -- the duplicate-merge path needs exactly the same work and having it here only
  -- left that path stranding a retired membership's consent and links.
  perform private.reconcile_contacts(p_circle_id, p_from, p_to);

  -- Queued mail for the person, not yet sent. A job left on the old identity is
  -- a message the dispatcher either sends to nobody or drops when retention
  -- takes the abandoned identity with it.
  update jobs.notification_jobs j set user_id = p_to
  where j.user_id = p_from
    and j.sent_at is null
    and j.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);
  perform set_config('circles.moving_membership', 'off', true);
end;
$$;

comment on function private.move_membership(uuid, uuid, uuid) is
  'Moves one circle membership and every row scoped to it from one identity to another. Shared by reattach_member and claim_identity; decides nothing.';

revoke all on function private.move_membership(uuid, uuid, uuid) from public;
revoke all on function private.move_membership(uuid, uuid, uuid) from anon, authenticated;

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
