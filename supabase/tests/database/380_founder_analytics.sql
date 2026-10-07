-- The founder's analytics screen (SUS-166): who may read it, what it can never
-- say, and whether the gates' numbers are right.
--
-- Two things are under test and they pull against each other. The numbers have
-- to be right, because a gate that reads "met" when it is not will be acted on.
-- And what leaves the database through `founder_analytics` is counts and
-- ratios: no user, no browser, no circle, no plan, no free text. The second is
-- the one that matters more, and it is asserted against the output itself and
-- against the views' own columns rather than against a list of what was meant.
--
-- The seed has circles, plans and events of its own, from this month. Every
-- fixture here is dated relative to today (see `pg_temp.d`) so a count over one day, or one week,
-- is a count of this file's scenario.

begin;
select plan(48);

create or replace function pg_temp.make_user(id uuid, name text, permanent boolean default true)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', not permanent,
    jsonb_build_object('is_anonymous', not permanent),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;

create or replace function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Dates are days from the Monday two weeks ago, so the scenario is always inside
-- the function's 400-day window and always in the past.
create or replace function pg_temp.d(n integer) returns date language sql as $$
  select (date_trunc('week', current_date) - interval '14 days')::date + n
$$;
create or replace function pg_temp.at(n integer, hhmm text) returns timestamptz language sql as $$
  select ((pg_temp.d(n)::text || ' ' || hhmm)::timestamp at time zone 'UTC')
$$;

-- Maya owns Sunday Crew; Priya and Tom are in it; Sam is on the allowlist and
-- owns nothing; Outsider is signed in and is nobody.
select pg_temp.make_user('00000000-0000-0000-0000-0000000f0001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f0002', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f0003', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f0004', 'Sam');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f0005', 'Outsider');

-- ---------------------------------------------------------------------------
-- Who may call it. The allowlist is checked against auth.uid(): there is no
-- parameter to put a founder's id in.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok(
  $$select public.founder_analytics(pg_temp.d(0))$$,
  '42501', null,
  'anon is refused'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000f0005');
select throws_ok(
  $$select public.founder_analytics(pg_temp.d(0))$$,
  '42501', 'not_allowed',
  'a signed-in user who is not on the allowlist is refused'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000f0001');
select throws_ok(
  $$select public.founder_analytics(pg_temp.d(0))$$,
  '42501', 'not_allowed',
  'and owning the circle being measured is not being the founder'
);

select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('anon', 'public.founder_analytics(date)', 'execute')
  and has_function_privilege('authenticated', 'public.founder_analytics(date)', 'execute'),
  'the grant is for signed-in users only, and the allowlist inside is what decides'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.founder_analytics(date)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.founder_analytics(date)'::regprocedure)
      @> array['search_path=""'],
  'it is a definer function with an empty search path, like founder_summary'
);
select ok(
  not has_table_privilege('authenticated', 'analytics.event_breakdown', 'select')
  and not has_table_privilege('anon', 'analytics.event_breakdown', 'select')
  and not has_table_privilege('service_role', 'analytics.event_breakdown', 'select')
  and not has_table_privilege('authenticated', 'analytics.gate_unchased', 'select')
  and not has_table_privilege('service_role', 'analytics.open_to_response', 'select'),
  'the new views are readable by no role at all: the function is the only way in'
);

insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-0000000f0004');

select pg_temp.act_as('00000000-0000-0000-0000-0000000f0004');
select throws_ok(
  $$select public.founder_analytics(null)$$,
  '22023', 'invalid_period',
  'a period is required'
);
select is(
  (select array(select jsonb_object_keys(public.founder_analytics(pg_temp.d(2))) order by 1)),
  array['counters', 'events', 'gates', 'north_star', 'since'],
  'somebody on the allowlist gets the five parts'
);
select is(
  public.founder_analytics(pg_temp.d(2)) ->> 'since',
  pg_temp.d(0)::text,
  'from the Monday of the week the period starts in, so a week is a whole week'
);
select is(
  public.founder_analytics(date '2000-01-01') ->> 'since',
  date_trunc('week', current_date - 400)::date::text,
  'a period is clamped to 400 days, and the answer says from when it is'
);
select is(
  (select array(select jsonb_object_keys(public.founder_analytics(pg_temp.d(2)) -> 'gates') order by 1)),
  array['another_in_cadence', 'claim_moments', 'confirm_in_week', 'confirmed_meetup', 'email_verified',
        'happened', 'other_organiser', 'reattach', 'response_time', 'second_meetup', 'unchased'],
  'every gate a view computes is in it, and a gate nothing computes is not (the screen says "Not measured")'
);

-- ---------------------------------------------------------------------------
-- event_breakdown: counts by week, and by value for booleans and enum words.
-- Everything else is excluded here, in SQL.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

insert into analytics.events (event_id, event_name, schema_version, user_id, circle_id, plan_id, properties, occurred_at)
select gen_random_uuid(), 'availability_started', 1, null, null, null, p, pg_temp.at(1, '10:00')
from (values
  ('{"usual_offered": true}'::jsonb), ('{"usual_offered": true}'), ('{"usual_offered": false}'), ('{}')
) as v (p);

insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'availability_submitted', 1, p, pg_temp.at(2, '10:00')
from (values
  ('{"status": "windows", "usual_used": true, "window_count": 3}'::jsonb),
  ('{"status": "windows", "usual_used": false, "window_count": 2}'),
  ('{"status": "flexible", "usual_used": false}')
) as v (p);

-- The same event the week before, so a week is a week.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
values (gen_random_uuid(), 'availability_started', 1, '{"usual_offered": true}', pg_temp.at(-6, '10:00'));

-- Attributed events, whose ids must never come out.
insert into analytics.events (event_id, event_name, schema_version, user_id, circle_id, plan_id, properties, occurred_at)
values (gen_random_uuid(), 'circle_joined', 1, '00000000-0000-0000-0000-0000000f0002',
        '00000000-0000-0000-0000-00000000c1c1', '00000000-0000-0000-0000-00000000d1d1',
        '{"source": "invite"}', pg_temp.at(1, '11:00'));
insert into analytics.events (event_id, event_name, schema_version, anonymous_id, properties, occurred_at)
values (gen_random_uuid(), 'circle_join_opened', 1, repeat('b', 64), '{}', pg_temp.at(1, '11:00'));

-- A made-up event with every shape a value can take that is not an enum. The
-- table lets a short code through, and so does an ingest that has a bug.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
values (gen_random_uuid(), 'probe_event', 1, jsonb_build_object(
  'label', 'Maya_and_Priya_Sunday',             -- free-text-shaped: capitals
  'shout', 'ThisIsMixedCase',                   -- ditto
  'long_word', 'a_word_far_too_long_to_be_enum', -- over 24 characters
  'digits', 'abc123def456',                     -- a hash's shape
  'build', 'abcdef',                            -- a lower-case commit hash
  'reference', 'abcdefg',                       -- what a person reads out
  'circle_id', '00000000-0000-0000-0000-00000000c1c1',
  'plan_id', 'abcdefabc',                       -- an id written in letters
  'amount', 5,                                  -- a number is not a category
  'kind', 'ordinary'                            -- a real enum word
), pg_temp.at(1, '12:00'));

-- A field of thirteen different lower-case words is not an enum, however each
-- one looks on its own: that is what ids written in letters would look like.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'probe_event', 1,
       jsonb_build_object('alias', 'person_' || chr(96 + n)), pg_temp.at(1, '12:00')
from generate_series(1, 13) n;
-- ... and twelve are.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'probe_event', 1,
       jsonb_build_object('shade', 'tone_' || chr(96 + n)), pg_temp.at(1, '12:00')
from generate_series(1, 12) n;

-- `code` is an enum in exactly one event; anywhere else it is a short code.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
values
  (gen_random_uuid(), 'email_delivery_result', 1, '{"code": "bounced"}', pg_temp.at(1, '12:00')),
  (gen_random_uuid(), 'email_delivery_result', 1, '{"code": "delivered"}', pg_temp.at(1, '12:00')),
  (gen_random_uuid(), 'probe_event', 1, '{"code": "pnanaa"}', pg_temp.at(1, '12:00'));

-- The quiet ask's two unattributed events: counts, and nothing a row of them
-- carries, even if it carried something.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
values
  (gen_random_uuid(), 'quiet_ask_created', 2, '{"stage": "open"}', pg_temp.at(1, '13:00')),
  (gen_random_uuid(), 'quiet_ask_created', 2, '{}', pg_temp.at(1, '13:00')),
  (gen_random_uuid(), 'quiet_interest_answered', 2, '{"answer": "yes"}', pg_temp.at(1, '13:00'));

create temporary table fa (j jsonb) on commit drop;
grant all on fa to authenticated;

create or replace function pg_temp.rows(p_event text, p_week date)
returns table (field text, value text, events int) language sql as $$
  select e ->> 'field', e ->> 'value', (e ->> 'events')::int
  from fa, jsonb_array_elements(fa.j -> 'events') e
  where e ->> 'event_name' = p_event and (e ->> 'week')::date = p_week
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000f0004');
insert into fa select public.founder_analytics(pg_temp.d(-6));

select is(
  (select events from pg_temp.rows('availability_started', pg_temp.d(0)) where field is null),
  4,
  'an event''s weekly count is every row of it that week'
);
select is(
  (select events from pg_temp.rows('availability_started', pg_temp.d(-7)) where field is null),
  1,
  'and the week before is its own'
);
select is(
  (select array_agg(value || ':' || events order by value) from pg_temp.rows('availability_started', pg_temp.d(0))
   where field = 'usual_offered'),
  array['false:1', 'true:2'],
  'a boolean field splits by value, and an event without the field is in the total and in neither value'
);
select is(
  (select array_agg(value || ':' || events order by value) from pg_temp.rows('availability_submitted', pg_temp.d(0))
   where field = 'status'),
  array['flexible:1', 'windows:2'],
  'an enum field splits by value'
);
select is(
  (select array_agg(value || ':' || events order by value) from pg_temp.rows('availability_submitted', pg_temp.d(0))
   where field = 'usual_used'),
  array['false:2', 'true:1'],
  'and SUS-159''s usual_used is there with no change to anything'
);
select is(
  (select count(*)::int from pg_temp.rows('availability_submitted', pg_temp.d(0)) where field = 'window_count'),
  0,
  'a number is a count and not a category: window_count has no split'
);

select is(
  (select array_agg(distinct field order by field) from pg_temp.rows('probe_event', pg_temp.d(0)) where field is not null),
  array['kind', 'shade'],
  'of everything a made-up event carries, only the enum word and the twelve-valued field get a split'
);
select is(
  (select count(*)::int from pg_temp.rows('probe_event', pg_temp.d(0)) where value ~ '[A-Z]'),
  0,
  'a free-text-shaped value is absent: nothing with a capital letter, a hash or a long phrase comes out'
);
select is(
  (select count(*)::int from pg_temp.rows('probe_event', pg_temp.d(0))
   where field in ('circle_id', 'plan_id', 'build', 'reference', 'alias', 'label', 'digits', 'long_word', 'shout')),
  0,
  'and neither is the field it came in: identifiers, hashes, references and a field of thirteen words are excluded in SQL'
);

select is(
  (select array_agg(value order by value) from pg_temp.rows('email_delivery_result', pg_temp.d(0)) where field = 'code'),
  array['bounced', 'delivered'],
  'the delivery result splits by its enum, which is a code the catalogue declares'
);
select is(
  (select count(*)::int from pg_temp.rows('probe_event', pg_temp.d(0)) where field = 'code'),
  0,
  'while a code on any other event is a short code and is not split'
);
select is(
  (select array_agg(field order by field nulls first) from pg_temp.rows('quiet_ask_created', pg_temp.d(0))),
  array[null::text],
  'a quiet ask event is one row, its total, whatever its row carries'
);
select is(
  (select events from pg_temp.rows('quiet_ask_created', pg_temp.d(0))),
  2,
  'and the total is right'
);
select is(
  (select count(*)::int from pg_temp.rows('quiet_interest_answered', pg_temp.d(0)) where field is not null),
  0,
  'the same for the interest answer: it can never be split by its answer'
);

-- What comes out names nobody, anywhere in it.
select is(
  (select j::text ~* '00000000-0000-0000-0000-0000000f000|00000000-0000-0000-0000-00000000c1c1|00000000-0000-0000-0000-00000000d1d1|bbbbbbbb|Maya|Priya|Tom|Sam|Outsider|Sunday|ThisIsMixedCase|abcdefabc|abc123def456' from fa),
  false,
  'no user, browser, circle or plan id, no name and no free text appears anywhere in the answer'
);
select is(
  (select j::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' from fa),
  false,
  'and nothing shaped like a uuid does, whatever it is'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'analytics'
     and table_name in ('event_breakdown', 'gate_circles_confirm', 'gate_unchased', 'open_to_response',
       'gate_happened', 'gate_reattach', 'gate_second_meetup', 'gate_other_organiser', 'gate_email_verified',
       'gate_confirm_in_week', 'gate_another_in_cadence', 'gate_claim_moments', 'funnel_counts')
     and (column_name ~ '(^|_)id$' or column_name ~* '^(user|anonymous|circle_|plan_|email|name|display)')),
  0,
  'no column of any of the new views is a user, anonymous, circle or plan id, a name or an email'
);

-- ---------------------------------------------------------------------------
-- The gates, from one scenario two weeks ago.
--
-- Sunday Crew, made on the 3rd by Maya (weekly), meets on the 5th, and makes a
-- second plan on the 10th, organised by Priya, which meets on the 12th. A
-- second circle made the same day never meets.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000f0001');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-fa', 'weekly');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f0005');
select public.create_circle('Never Met', 'sky', 'Australia/Melbourne', 'key-fa-never');
select pg_temp.act_as_postgres();
update public.circles set created_at = pg_temp.at(0, '00:00') where creation_key in ('key-fa', 'key-fa-never');

create temporary table t as select id as circle_id from public.circles where creation_key = 'key-fa';
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u, n from t, (values
  ('00000000-0000-0000-0000-0000000f0002'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-0000000f0003'::uuid, 'Tom')
) as v (u, n);

create or replace function pg_temp.meetup(code text, organiser uuid, made date, day date, chased text)
returns uuid language plpgsql as $$
declare
  new_plan uuid;
  new_conf uuid;
begin
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code, created_at
  )
  select circle_id, 'named', 'confirmed', organiser, 'Catch up', 'Australia/Melbourne',
    day, day + 3, 1050, 1350, 120, 2,
    (day::timestamp + interval '1 day') at time zone 'Australia/Melbourne', code,
    made::timestamptz
  from t returning id into new_plan;

  insert into public.plan_participants (plan_id, revision, user_id)
  select new_plan, 1, u from unnest(array[
    '00000000-0000-0000-0000-0000000f0001'::uuid,
    '00000000-0000-0000-0000-0000000f0002'::uuid,
    '00000000-0000-0000-0000-0000000f0003'::uuid
  ]) as u;

  insert into public.meetup_confirmations (
    plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by,
    status, confirmed_at, chased_answer
  ) values (
    new_plan, 1, (day::timestamp + interval '18 hours 30 minutes')::text,
    (day::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
    (day::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
    array['00000000-0000-0000-0000-0000000f0001'::uuid], '00000000-0000-0000-0000-0000000f0001',
    'active', day::timestamptz, chased
  ) returning id into new_conf;

  return new_conf;
end;
$$;

select pg_temp.meetup('fapaaa', '00000000-0000-0000-0000-0000000f0001', pg_temp.d(0), pg_temp.d(2), 'none') as first_meetup \gset
select pg_temp.meetup('fapaab', '00000000-0000-0000-0000-0000000f0002', pg_temp.d(7), pg_temp.d(9), 'one') as second_meetup \gset

insert into public.outcome_reports (confirmation_id, reported_by, outcome, reported_at)
values (:'first_meetup', '00000000-0000-0000-0000-0000000f0001', 'happened', pg_temp.at(3, '09:00'));
insert into public.attendance (confirmation_id, user_id, status)
values (:'first_meetup', '00000000-0000-0000-0000-0000000f0002', 'was_there');

select is(
  (select array[circles, confirmed] from analytics.gate_circles_confirm where day = pg_temp.d(0)),
  array[2::bigint, 1::bigint],
  'every test circle confirms a meetup: two were made that day and one did'
);
-- Two members answered the first plan, and one the second.
insert into public.plan_responses (plan_id, revision, user_id, status, submitted_at, created_at)
select p.id, p.revision, u, 'flexible', pg_temp.at(1, '10:02'), pg_temp.at(1, '10:02')
from public.plans p, unnest(array['00000000-0000-0000-0000-0000000f0003'::uuid]) u
where p.short_code = 'fapaaa';
insert into public.plan_responses (plan_id, revision, user_id, status, submitted_at, created_at)
select p.id, p.revision, '00000000-0000-0000-0000-0000000f0002', 'flexible', pg_temp.at(5, '10:00'), pg_temp.at(5, '10:00')
from public.plans p where p.short_code = 'fapaab';
select is(
  (select array[members, unchased] from analytics.gate_unchased where day = pg_temp.d(2)),
  array[3::bigint, 1::bigint],
  'chasing, in members: of three the plan asked, one answered and the organiser chased nobody, so one answered unchased, and the two who did not answer are in the denominator'
);
select is(
  (select array[members, unchased] from analytics.gate_unchased where day = pg_temp.d(9)),
  array[3::bigint, 0::bigint],
  'and where they said they chased one of the one who answered, nobody counts as having answered unchased'
);
select is(
  (select array[meetups, happened] from analytics.gate_happened where day = pg_temp.d(2)),
  array[1::bigint, 1::bigint],
  'a meetup that is over and was reported as having happened is counted as having happened'
);
select is(
  (select array[meetups, happened] from analytics.gate_happened where day = pg_temp.d(9)),
  array[1::bigint, 0::bigint],
  'and one that is over and was not reported is counted as one that did not'
);

-- Response after a link open: ninety seconds.
insert into analytics.events (event_id, event_name, schema_version, user_id, plan_id, properties, occurred_at)
select gen_random_uuid(), 'availability_started', 1, '00000000-0000-0000-0000-0000000f0002', p.id, '{}',
       pg_temp.at(1, '10:00')
from public.plans p where p.short_code = 'fapaaa';
insert into public.plan_responses (plan_id, revision, user_id, status, submitted_at, created_at)
select p.id, p.revision, '00000000-0000-0000-0000-0000000f0002', 'flexible',
       pg_temp.at(1, '10:01:30'), pg_temp.at(1, '10:01:30')
from public.plans p where p.short_code = 'fapaaa';
select is(
  (select array_agg(seconds) from analytics.open_to_response where day = pg_temp.d(1)),
  array[90::numeric],
  'the wait from the link open to the answer is measured in seconds, with no person or plan beside it'
);

insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), n, 1, case when n = 'member_reattached' then '{"source": "list"}'::jsonb else '{}' end,
       pg_temp.at(3, '10:00')
from (values
  ('session_missing_on_return'), ('session_missing_on_return'), ('session_missing_on_return'),
  ('session_missing_on_return'), ('session_missing_on_return'),
  ('member_reattached'), ('member_reattached'), ('member_reattached'), ('member_reattached')
) as v (n);
-- Somebody arriving from an emailed link is a different population, in neither half.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'member_reattached', 1, '{"source": "email"}', pg_temp.at(3, '10:00')
from generate_series(1, 5);
select is(
  (select array[missing, reattached] from analytics.gate_reattach where day = pg_temp.d(3)),
  array[5::bigint, 4::bigint],
  'returns with no session, and the ones that got back in from the list: the five who came by an emailed link are in neither number'
);

select is(
  (select circles from analytics.gate_second_meetup where day = pg_temp.d(7)),
  1::bigint,
  'a group that made another plan after its first meetup was confirmed has started a second meetup'
);
select is(
  (select plans from analytics.gate_other_organiser where day = pg_temp.d(7)),
  1::bigint,
  'and that plan was organised by somebody other than the owner'
);
select is(
  (select count(*)::int from analytics.gate_other_organiser where day = pg_temp.d(0)),
  0,
  'while the owner organising their own plan is the usual organiser and counts for nothing'
);

insert into analytics.events (event_id, event_name, schema_version, user_id, properties, occurred_at)
values
  -- Verified by the emailed link.
  (gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000f0002', '{"save_place": false}', pg_temp.at(4, '10:00')),
  (gen_random_uuid(), 'email_verified', 1, '00000000-0000-0000-0000-0000000f0002', '{}', pg_temp.at(4, '10:05')),
  -- Verified by typing the code back, which is how the default route says so.
  (gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000f0003', '{"save_place": true}', pg_temp.at(4, '10:00')),
  (gen_random_uuid(), 'account_claimed', 1, '00000000-0000-0000-0000-0000000f0003', '{"moment": "after_answer"}', pg_temp.at(4, '10:06')),
  -- Never verified.
  (gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000f0004', '{"save_place": true}', pg_temp.at(4, '10:00')),
  -- A saved member's one button: no route, nothing to verify, not a guest.
  (gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000f0001', '{}', pg_temp.at(4, '10:00'));
select is(
  (select array[submitted, verified] from analytics.gate_email_verified where day = pg_temp.d(4)),
  array[3::bigint, 2::bigint],
  'of three guests who submitted an email, two confirmed it, by either route; a saved member''s one button is not a guest'
);

select is(
  (select array[circles, confirmed_in_week] from analytics.gate_confirm_in_week where day = pg_temp.d(0)),
  array[2::bigint, 1::bigint],
  'external cohort: of two circles old enough to have had the week, one confirmed inside it'
);
select is(
  (select array[successful, another] from analytics.gate_another_in_cadence where day = pg_temp.d(2)),
  array[1::bigint, 1::bigint],
  'a weekly circle that met and made another plan before the next week was out has initiated another within its cadence'
);

insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'account_claimed', 1, jsonb_build_object('moment', m), pg_temp.at(5, '10:00')
from unnest(array['organiser_gate', 'organiser_gate', 'after_answer']) m;
select is(
  (select array[claims, elsewhere] from analytics.gate_claim_moments where day = pg_temp.d(5)),
  array[3::bigint, 1::bigint],
  'saved places claimed away from the organiser gate are counted against all of them'
);

select is(
  (select array_agg(counter || ':' || n order by counter) from analytics.funnel_counts where day = pg_temp.d(0)),
  array['circles_activated:1', 'circles_created:2', 'plans_created:1'],
  'the funnel''s row counts are read from the rows, by the day they happened'
);
-- A plan decided twice is one plan decided, and a member answering a second plan
-- is not a second first response.
insert into public.meetup_confirmations (
  plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by, status,
  confirmed_at, superseded_at, superseded_reason
)
select mc.plan_id, 2, mc.candidate_id, mc.starts_at, mc.ends_at, mc.available_user_ids, mc.confirmed_by,
       'superseded', pg_temp.at(3, '09:00'), pg_temp.at(4, '09:00'), 'reopen'
from public.meetup_confirmations mc where mc.id = :'first_meetup';
select is(
  (select array_agg(day order by day) from analytics.funnel_counts
   where counter = 'plans_confirmed' and day between pg_temp.d(0) and pg_temp.d(9)),
  array[pg_temp.d(2), pg_temp.d(9)],
  'a plan confirmed again on another day is counted on the day it was first confirmed, once'
);
select is(
  (select array_agg(day::text || ':' || n order by day) from analytics.funnel_counts
   where counter = 'answers' and day between pg_temp.d(0) and pg_temp.d(9)),
  array[pg_temp.d(1)::text || ':2'],
  'and a member answering a second plan is not a second first response: two members, two'
);

select is(
  (select n from analytics.funnel_counts where counter = 'corroborated' and day = pg_temp.d(3)),
  1::bigint,
  'a reported meetup somebody else was at is corroborated'
);

-- The function reads the same numbers, summed over the period.
select pg_temp.act_as('00000000-0000-0000-0000-0000000f0004');
select ok(
  (public.founder_analytics(pg_temp.d(0)) -> 'gates' -> 'second_meetup' ->> 'count')::int >= 1
  and (public.founder_analytics(pg_temp.d(0)) -> 'gates' -> 'reattach' ->> 'numerator')::int >= 4
  and (public.founder_analytics(pg_temp.d(0)) -> 'gates' -> 'response_time' -> 'n') is not null
  and (public.founder_analytics(pg_temp.d(0)) -> 'counters' ->> 'plans_created')::int >= 2,
  'the function reads the same numbers, summed over the period'
);
select is(
  (select array(select jsonb_object_keys(public.founder_analytics(pg_temp.d(0)) -> 'gates' -> 'response_time') order by 1)),
  array['median_seconds', 'n'],
  'and a median gate says its median and how many answers it is the median of'
);

select * from finish();
rollback;
