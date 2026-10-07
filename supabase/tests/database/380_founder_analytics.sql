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
-- fixture here is dated in November 2025 so a count over one day, or one week,
-- is a count of this file's scenario.

begin;
select plan(43);

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
  $$select public.founder_analytics(date '2025-11-03')$$,
  '42501', null,
  'anon is refused'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000f0005');
select throws_ok(
  $$select public.founder_analytics(date '2025-11-03')$$,
  '42501', 'not_allowed',
  'a signed-in user who is not on the allowlist is refused'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000f0001');
select throws_ok(
  $$select public.founder_analytics(date '2025-11-03')$$,
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
  (select array(select jsonb_object_keys(public.founder_analytics(date '2025-11-05')) order by 1)),
  array['counters', 'events', 'gates', 'north_star', 'since'],
  'somebody on the allowlist gets the five parts'
);
select is(
  public.founder_analytics(date '2025-11-05') ->> 'since',
  '2025-11-03',
  'from the Monday of the week the period starts in, so a week is a whole week'
);
select is(
  (select array(select jsonb_object_keys(public.founder_analytics(date '2025-11-05') -> 'gates') order by 1)),
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
select gen_random_uuid(), 'availability_started', 1, null, null, null, p, timestamptz '2025-11-04T10:00:00Z'
from (values
  ('{"usual_offered": true}'::jsonb), ('{"usual_offered": true}'), ('{"usual_offered": false}'), ('{}')
) as v (p);

insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'availability_submitted', 1, p, timestamptz '2025-11-05T10:00:00Z'
from (values
  ('{"status": "windows", "usual_used": true, "window_count": 3}'::jsonb),
  ('{"status": "windows", "usual_used": false, "window_count": 2}'),
  ('{"status": "flexible", "usual_used": false}')
) as v (p);

-- The same event the week before, so a week is a week.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
values (gen_random_uuid(), 'availability_started', 1, '{"usual_offered": true}', timestamptz '2025-10-28T10:00:00Z');

-- Attributed events, whose ids must never come out.
insert into analytics.events (event_id, event_name, schema_version, user_id, circle_id, plan_id, properties, occurred_at)
values (gen_random_uuid(), 'circle_joined', 1, '00000000-0000-0000-0000-0000000f0002',
        '00000000-0000-0000-0000-00000000c1c1', '00000000-0000-0000-0000-00000000d1d1',
        '{"source": "invite"}', timestamptz '2025-11-04T11:00:00Z');
insert into analytics.events (event_id, event_name, schema_version, anonymous_id, properties, occurred_at)
values (gen_random_uuid(), 'circle_join_opened', 1, repeat('b', 64), '{}', timestamptz '2025-11-04T11:00:00Z');

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
), timestamptz '2025-11-04T12:00:00Z');

-- A field of thirteen different lower-case words is not an enum, however each
-- one looks on its own: that is what ids written in letters would look like.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'probe_event', 1,
       jsonb_build_object('alias', 'person_' || chr(96 + n)), timestamptz '2025-11-04T12:00:00Z'
from generate_series(1, 13) n;
-- ... and twelve are.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'probe_event', 1,
       jsonb_build_object('shade', 'tone_' || chr(96 + n)), timestamptz '2025-11-04T12:00:00Z'
from generate_series(1, 12) n;

-- The quiet ask's two unattributed events: counts, and nothing a row of them
-- carries, even if it carried something.
insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
values
  (gen_random_uuid(), 'quiet_ask_created', 2, '{"stage": "open"}', timestamptz '2025-11-04T13:00:00Z'),
  (gen_random_uuid(), 'quiet_ask_created', 2, '{}', timestamptz '2025-11-04T13:00:00Z'),
  (gen_random_uuid(), 'quiet_interest_answered', 2, '{"answer": "yes"}', timestamptz '2025-11-04T13:00:00Z');

create temporary table fa (j jsonb) on commit drop;
grant all on fa to authenticated;

create or replace function pg_temp.rows(p_event text, p_week date)
returns table (field text, value text, events int) language sql as $$
  select e ->> 'field', e ->> 'value', (e ->> 'events')::int
  from fa, jsonb_array_elements(fa.j -> 'events') e
  where e ->> 'event_name' = p_event and (e ->> 'week')::date = p_week
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000f0004');
insert into fa select public.founder_analytics(date '2025-10-28');

select is(
  (select events from pg_temp.rows('availability_started', date '2025-11-03') where field is null),
  4,
  'an event''s weekly count is every row of it that week'
);
select is(
  (select events from pg_temp.rows('availability_started', date '2025-10-27') where field is null),
  1,
  'and the week before is its own'
);
select is(
  (select array_agg(value || ':' || events order by value) from pg_temp.rows('availability_started', date '2025-11-03')
   where field = 'usual_offered'),
  array['false:1', 'true:2'],
  'a boolean field splits by value, and an event without the field is in the total and in neither value'
);
select is(
  (select array_agg(value || ':' || events order by value) from pg_temp.rows('availability_submitted', date '2025-11-03')
   where field = 'status'),
  array['flexible:1', 'windows:2'],
  'an enum field splits by value'
);
select is(
  (select array_agg(value || ':' || events order by value) from pg_temp.rows('availability_submitted', date '2025-11-03')
   where field = 'usual_used'),
  array['false:2', 'true:1'],
  'and SUS-159''s usual_used is there with no change to anything'
);
select is(
  (select count(*)::int from pg_temp.rows('availability_submitted', date '2025-11-03') where field = 'window_count'),
  0,
  'a number is a count and not a category: window_count has no split'
);

select is(
  (select array_agg(distinct field order by field) from pg_temp.rows('probe_event', date '2025-11-03') where field is not null),
  array['kind', 'shade'],
  'of everything a made-up event carries, only the enum word and the twelve-valued field get a split'
);
select is(
  (select count(*)::int from pg_temp.rows('probe_event', date '2025-11-03') where value ~ '[A-Z]'),
  0,
  'a free-text-shaped value is absent: nothing with a capital letter, a hash or a long phrase comes out'
);
select is(
  (select count(*)::int from pg_temp.rows('probe_event', date '2025-11-03')
   where field in ('circle_id', 'plan_id', 'build', 'reference', 'alias', 'label', 'digits', 'long_word', 'shout')),
  0,
  'and neither is the field it came in: identifiers, hashes, references and a field of thirteen words are excluded in SQL'
);

select is(
  (select array_agg(field order by field nulls first) from pg_temp.rows('quiet_ask_created', date '2025-11-03')),
  array[null::text],
  'a quiet ask event is one row, its total, whatever its row carries'
);
select is(
  (select events from pg_temp.rows('quiet_ask_created', date '2025-11-03')),
  2,
  'and the total is right'
);
select is(
  (select count(*)::int from pg_temp.rows('quiet_interest_answered', date '2025-11-03') where field is not null),
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
-- The gates, from one scenario in November 2025.
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
update public.circles set created_at = timestamptz '2025-11-03T00:00:00Z' where creation_key in ('key-fa', 'key-fa-never');

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

select pg_temp.meetup('fapaaa', '00000000-0000-0000-0000-0000000f0001', date '2025-11-03', date '2025-11-05', 'none') as first_meetup \gset
select pg_temp.meetup('fapaab', '00000000-0000-0000-0000-0000000f0002', date '2025-11-10', date '2025-11-12', 'one') as second_meetup \gset

insert into public.outcome_reports (confirmation_id, reported_by, outcome, reported_at)
values (:'first_meetup', '00000000-0000-0000-0000-0000000f0001', 'happened', timestamptz '2025-11-06T09:00:00Z');
insert into public.attendance (confirmation_id, user_id, status)
values (:'first_meetup', '00000000-0000-0000-0000-0000000f0002', 'was_there');

select is(
  (select array[circles, confirmed] from analytics.gate_circles_confirm where day = date '2025-11-03'),
  array[2::bigint, 1::bigint],
  'every test circle confirms a meetup: two were made that day and one did'
);
select is(
  (select array[answered, unchased] from analytics.gate_unchased where day = date '2025-11-05'),
  array[1::bigint, 1::bigint],
  'chasing: one organiser said they chased nobody'
);
select is(
  (select array[answered, unchased] from analytics.gate_unchased where day = date '2025-11-12'),
  array[1::bigint, 0::bigint],
  'and one said they chased somebody, which is an answer and not a yes'
);
select is(
  (select array[meetups, happened] from analytics.gate_happened where day = date '2025-11-05'),
  array[1::bigint, 1::bigint],
  'a meetup that is over and was reported as having happened is counted as having happened'
);
select is(
  (select array[meetups, happened] from analytics.gate_happened where day = date '2025-11-12'),
  array[1::bigint, 0::bigint],
  'and one that is over and was not reported is counted as one that did not'
);

-- Response after a link open: ninety seconds.
insert into analytics.events (event_id, event_name, schema_version, user_id, plan_id, properties, occurred_at)
select gen_random_uuid(), 'availability_started', 1, '00000000-0000-0000-0000-0000000f0002', p.id, '{}',
       timestamptz '2025-11-04T10:00:00Z'
from public.plans p where p.short_code = 'fapaaa';
insert into public.plan_responses (plan_id, revision, user_id, status, submitted_at, created_at)
select p.id, p.revision, '00000000-0000-0000-0000-0000000f0002', 'flexible',
       timestamptz '2025-11-04T10:01:30Z', timestamptz '2025-11-04T10:01:30Z'
from public.plans p where p.short_code = 'fapaaa';
select is(
  (select array_agg(seconds) from analytics.open_to_response where day = date '2025-11-04'),
  array[90::numeric],
  'the wait from the link open to the answer is measured in seconds, with no person or plan beside it'
);

insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), n, 1, case when n = 'member_reattached' then '{"source": "list"}'::jsonb else '{}' end,
       timestamptz '2025-11-06T10:00:00Z'
from (values
  ('session_missing_on_return'), ('session_missing_on_return'), ('session_missing_on_return'),
  ('session_missing_on_return'), ('session_missing_on_return'),
  ('member_reattached'), ('member_reattached'), ('member_reattached'), ('member_reattached')
) as v (n);
select is(
  (select array[missing, reattached] from analytics.gate_reattach where day = date '2025-11-06'),
  array[5::bigint, 4::bigint],
  'returns with no session, and the ones that got back in'
);

select is(
  (select circles from analytics.gate_second_meetup where day = date '2025-11-10'),
  1::bigint,
  'a group that made another plan after its first meetup was confirmed has started a second meetup'
);
select is(
  (select plans from analytics.gate_other_organiser where day = date '2025-11-10'),
  1::bigint,
  'and that plan was organised by somebody other than the owner'
);
select is(
  (select count(*)::int from analytics.gate_other_organiser where day = date '2025-11-03'),
  0,
  'while the owner organising their own plan is the usual organiser and counts for nothing'
);

insert into analytics.events (event_id, event_name, schema_version, user_id, properties, occurred_at)
values
  (gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000f0002', '{}', timestamptz '2025-11-07T10:00:00Z'),
  (gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000f0003', '{}', timestamptz '2025-11-07T10:00:00Z'),
  (gen_random_uuid(), 'email_verified', 1, '00000000-0000-0000-0000-0000000f0002', '{}', timestamptz '2025-11-07T10:05:00Z');
select is(
  (select array[submitted, verified] from analytics.gate_email_verified where day = date '2025-11-07'),
  array[2::bigint, 1::bigint],
  'of two guests who submitted an email, one verified it'
);

select is(
  (select array[circles, confirmed_in_week] from analytics.gate_confirm_in_week where day = date '2025-11-03'),
  array[2::bigint, 1::bigint],
  'external cohort: of two circles old enough to have had the week, one confirmed inside it'
);
select is(
  (select array[successful, another] from analytics.gate_another_in_cadence where day = date '2025-11-05'),
  array[1::bigint, 1::bigint],
  'a weekly circle that met and made another plan before the next week was out has initiated another within its cadence'
);

insert into analytics.events (event_id, event_name, schema_version, properties, occurred_at)
select gen_random_uuid(), 'account_claimed', 1, jsonb_build_object('moment', m), timestamptz '2025-11-08T10:00:00Z'
from unnest(array['organiser_gate', 'organiser_gate', 'after_answer']) m;
select is(
  (select array[claims, elsewhere] from analytics.gate_claim_moments where day = date '2025-11-08'),
  array[3::bigint, 1::bigint],
  'saved places claimed away from the organiser gate are counted against all of them'
);

select is(
  (select array_agg(counter || ':' || n order by counter) from analytics.funnel_counts where day = date '2025-11-03'),
  array['circles_activated:1', 'circles_created:2', 'plans_created:1'],
  'the funnel''s row counts are read from the rows, by the day they happened'
);
select is(
  (select n from analytics.funnel_counts where counter = 'corroborated' and day = date '2025-11-06'),
  1::bigint,
  'a reported meetup somebody else was at is corroborated'
);

-- The function reads the same numbers, summed over the period.
select pg_temp.act_as('00000000-0000-0000-0000-0000000f0004');
select ok(
  (public.founder_analytics(date '2025-11-03') -> 'gates' -> 'second_meetup' ->> 'count')::int >= 1
  and (public.founder_analytics(date '2025-11-03') -> 'gates' -> 'reattach' ->> 'numerator')::int >= 4
  and (public.founder_analytics(date '2025-11-03') -> 'gates' -> 'response_time' -> 'n') is not null
  and (public.founder_analytics(date '2025-11-03') -> 'counters' ->> 'plans_created')::int >= 2,
  'the function reads the same numbers, summed over the period'
);
select is(
  (select array(select jsonb_object_keys(public.founder_analytics(date '2025-11-03') -> 'gates' -> 'response_time') order by 1)),
  array['median_seconds', 'n'],
  'and a median gate says its median and how many answers it is the median of'
);

select * from finish();
rollback;
