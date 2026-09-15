-- The numbers, and who may read them.
--
-- Two things are under test and they pull in opposite directions. The measuring
-- has to be right — a north-star metric nobody can trust is worse than none,
-- because it will still be used to decide things. And the measuring may not
-- become a way to learn about people: the one function here that answers an
-- unauthenticated stranger returns a circle's name, and the six views are
-- readable by nobody who is not deliberately named in a table.

begin;
select plan(37);

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

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Maya owns Sunday Crew; Priya and Tom are in it.
select pg_temp.make_user('00000000-0000-0000-0000-00000000aa01', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000aa02', 'Priya', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000aa03', 'Tom', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000aa04', 'Outsider');

select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-analytics');

select pg_temp.act_as_postgres();
-- Backdated so that "within seven days of being made" is a question about this
-- circle rather than about a fixture that confirmed before it existed. Its
-- first meetup is confirmed on 5 March, three days later, so it activates in
-- §11.2's sense and belongs in the north star's denominator.
update public.circles set created_at = timestamptz '2026-03-01T00:00:00Z'
where creation_key = 'key-analytics';

create temporary table t as select id as circle_id from public.circles where creation_key = 'key-analytics';
grant select on t to anon, authenticated, service_role;
create or replace function pg_temp.circle() returns uuid
language sql security definer as $$ select circle_id from t $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u, n from t, (values
  ('00000000-0000-0000-0000-00000000aa02'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-00000000aa03'::uuid, 'Tom')
) as v (u, n);

-- ---------------------------------------------------------------------------
-- The link-preview card: a circle's name, to anybody, and nothing else.
-- ---------------------------------------------------------------------------
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-00000000aa01',
  'Secret dinner nobody may preview', 'Australia/Melbourne',
  date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
  timestamptz '2099-09-20T10:00:00Z', 'pnanaa'
from t;

select pg_temp.act_as_anon();
select is(
  public.preview_for_code('p', 'pnanaa'),
  'Sunday Crew',
  'a stranger with the short code gets the circle name, which is what the chat card needs'
);
select is(
  public.preview_for_code('j', 'pnanaa'),
  'Sunday Crew',
  'and the same for the invite link, which is the same plan seen from the chat'
);
select is(
  public.preview_for_code('p', 'pnanaa') ~ 'Secret dinner',
  false,
  'and never the plan''s title: a card is rendered to a whole thread, including people outside the circle'
);
select is(
  public.preview_for_code('join', 'pnanaa'),
  null,
  'a circle invite has no preview at all — its secret lives in the fragment, which never reaches a server'
);
select is(
  public.preview_for_code('p', 'pnanab'),
  null,
  'a code that is not ours says nothing, so the short-code space cannot be walked for circles that exist'
);
select is(
  public.preview_for_code('p', 'DROP TABLE'),
  null,
  'and a code that is not even a code is refused on shape, before it reaches a table'
);

select pg_temp.act_as_postgres();
update public.circles set status = 'archived' where id = pg_temp.circle();
select pg_temp.act_as_anon();
select is(
  public.preview_for_code('p', 'pnanaa'),
  null,
  'an archived circle stops previewing, the same way it stops being anything else'
);
select pg_temp.act_as_postgres();
update public.circles set status = 'active' where id = pg_temp.circle();

-- ---------------------------------------------------------------------------
-- The ingest's table: append-only, and nothing a person wrote.
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'analytics.events', 'insert')
  and not has_table_privilege('anon', 'analytics.events', 'insert')
  and not has_table_privilege('authenticated', 'analytics.events', 'select'),
  'no client role writes or reads analytics directly: the ingest function is the door'
);
select ok(
  has_table_privilege('service_role', 'analytics.events', 'insert')
  and not has_table_privilege('service_role', 'analytics.events', 'update')
  and not has_table_privilege('service_role', 'analytics.events', 'delete'),
  'and even the ingest can only append — an event is a record, not a row to be corrected'
);

insert into analytics.events (event_id, event_name, schema_version, properties)
values ('00000000-0000-0000-0000-0000000000e1', 'circle_join_opened', 1, '{}'::jsonb);

select throws_ok(
  $$insert into analytics.events (event_id, event_name, schema_version, properties)
    values ('00000000-0000-0000-0000-0000000000e1', 'circle_join_opened', 1, '{}'::jsonb)$$,
  '23505',
  null,
  'the same event twice is one row: a client that resends a batch it could not confirm does not inflate a funnel'
);

select throws_ok(
  $$insert into analytics.events (event_id, event_name, schema_version, properties)
    values (gen_random_uuid(), 'circle_created', 1, '{"place_name": "Hope St Radio"}'::jsonb)$$,
  '23514',
  null,
  'and a payload carrying somebody''s words is refused by the table as well as by the catalogue'
);

select pg_temp.act_as_service();
select is(
  public.record_events(jsonb_build_array(
    jsonb_build_object(
      'event_id', '00000000-0000-0000-0000-0000000000e2',
      'event_name', 'circle_joined', 'schema_version', 1,
      'properties', jsonb_build_object('member_count', 3),
      'occurred_at', '2026-03-01T00:00:00Z'),
    jsonb_build_object(
      'event_id', '00000000-0000-0000-0000-0000000000e3',
      'event_name', 'circle_join_opened', 'schema_version', 1,
      'circle_id', pg_temp.circle(),
      'properties', '{}'::jsonb,
      'occurred_at', '2026-03-01T00:00:00Z')
  )),
  2,
  'the ingest lands a batch through one function, because analytics is not a schema PostgREST exposes'
);

select is(
  public.record_events(jsonb_build_array(
    jsonb_build_object(
      'event_id', '00000000-0000-0000-0000-0000000000e2',
      'event_name', 'circle_joined', 'schema_version', 1,
      'properties', jsonb_build_object('member_count', 3),
      'occurred_at', '2026-03-01T00:00:00Z')
  )),
  0,
  'and the same batch again lands nothing: a client that could not hear the answer resends it'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from analytics.events where event_name = 'circle_joined'),
  1,
  'so the funnel counts one join, not two'
);

-- ---------------------------------------------------------------------------
-- The moments, which are declared in two languages.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(m[1] order by m[1])
   from regexp_matches(
     (select pg_get_constraintdef(oid) from pg_constraint where conname = 'nudge_states_moment'),
     '''([a-z_]+)''::text', 'g') as m),
  array['after_answer', 'after_attendance', 'after_confirmed', 'confirmed',
        'reattached', 'second_response', 'settings'],
  'the nudge moments the database accepts are exactly NUDGE_MOMENTS in packages/contracts (analytics.test.ts holds the other half)'
);

-- ---------------------------------------------------------------------------
-- The north star: reported happened, and corroborated shown separately.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

create or replace function pg_temp.confirmed_plan(code text, day date) returns uuid
language plpgsql as $$
declare
  new_plan uuid;
  new_conf uuid;
begin
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  )
  select circle_id, 'named', 'confirmed', '00000000-0000-0000-0000-00000000aa01',
    'Catch up', 'Australia/Melbourne', day, day + 3, 1050, 1350, 120, 2,
    (day::timestamp + interval '1 day') at time zone 'Australia/Melbourne', code
  from t returning id into new_plan;

  insert into public.plan_participants (plan_id, revision, user_id)
  select new_plan, 1, u from unnest(array[
    '00000000-0000-0000-0000-00000000aa01'::uuid,
    '00000000-0000-0000-0000-00000000aa02'::uuid,
    '00000000-0000-0000-0000-00000000aa03'::uuid
  ]) as u;

  insert into public.meetup_confirmations (
    plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by,
    status, confirmed_at
  ) values (
    new_plan, 1, (day::timestamp + interval '18 hours 30 minutes')::text,
    (day::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
    (day::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
    array['00000000-0000-0000-0000-00000000aa01'::uuid], '00000000-0000-0000-0000-00000000aa01',
    'active', (day::timestamp) at time zone 'Australia/Melbourne'
  ) returning id into new_conf;

  return new_conf;
end;
$$;

select pg_temp.confirmed_plan('pnanba', date '2026-03-05') as march \gset
select pg_temp.confirmed_plan('pnanbb', date '2026-03-19') as march_two \gset

-- One that happened and somebody else says so; one that happened on the
-- organiser's word alone.
insert into public.outcome_reports (confirmation_id, reported_by, outcome, reported_at)
values
  (:'march', '00000000-0000-0000-0000-00000000aa01', 'happened', timestamptz '2026-03-06T09:00:00Z'),
  (:'march_two', '00000000-0000-0000-0000-00000000aa01', 'happened', timestamptz '2026-03-20T09:00:00Z');

insert into public.attendance (confirmation_id, user_id, status)
values
  (:'march', '00000000-0000-0000-0000-00000000aa02', 'was_there'),
  -- The reporter's own `was_there` is not corroboration: one person agreeing
  -- with themselves is the thing the second number exists to exclude.
  (:'march_two', '00000000-0000-0000-0000-00000000aa01', 'was_there');

select is(
  (select happened_reported from analytics.north_star_monthly
   where month = date_trunc('month', timestamptz '2026-03-06T09:00:00Z')),
  2::bigint,
  'both meetups that were reported as having happened are counted'
);
select is(
  (select happened_corroborated from analytics.north_star_monthly
   where month = date_trunc('month', timestamptz '2026-03-06T09:00:00Z')),
  1::bigint,
  'and only the one somebody other than the reporter says they were at is corroborated'
);
select is(
  (select activated_circles from analytics.north_star_monthly
   where month = date_trunc('month', timestamptz '2026-03-06T09:00:00Z')),
  1::bigint,
  'against a denominator of circles that have ever confirmed a meetup'
);

-- ---------------------------------------------------------------------------
-- The rest of the six, on the same scenario.
-- ---------------------------------------------------------------------------
-- A meetup reported at midnight on 1 February in Melbourne is a February
-- meetup. `date_trunc` on a `timestamptz` runs in the database's zone, which is
-- UTC, and would have filed it under January.
select pg_temp.confirmed_plan('pnanbc', date '2026-01-20') as summer \gset
insert into public.outcome_reports (confirmation_id, reported_by, outcome, reported_at)
values (:'summer', '00000000-0000-0000-0000-00000000aa01', 'happened',
        timestamptz '2026-01-31T13:00:00Z');

select is(
  (select array[
     (select happened_reported from analytics.north_star_monthly where month = timestamp '2026-01-01'),
     (select happened_reported from analytics.north_star_monthly where month = timestamp '2026-02-01')
   ]),
  array[0::bigint, 1::bigint],
  'a meetup is counted in the month the circle was in, not the month UTC was in'
);

-- And the months in between are months, not gaps: a chart that skips a quiet
-- month shows no dip, which is the one thing a north-star chart is for.
select is(
  (select array_agg(happened_reported order by month) from analytics.north_star_monthly
   where month between timestamp '2026-04-01' and timestamp '2026-06-01'),
  array[0::bigint, 0::bigint, 0::bigint],
  'and the quiet months between are present and empty rather than missing'
);

select is(
  (select confirmations from analytics.funnel_by_circle where circle_id = pg_temp.circle()),
  3::bigint,
  'the funnel counts confirmations from the rows, not from events that an ad-blocker can eat'
);
select is(
  (select happened from analytics.funnel_by_circle where circle_id = pg_temp.circle()),
  3::bigint,
  'and the same for what happened'
);

insert into public.nudge_states (user_id, moment, plan_id, answer)
select '00000000-0000-0000-0000-00000000aa02', 'confirmed', p.id, 'tapped'
from public.plans p where p.short_code = 'pnanba';
insert into public.nudge_states (user_id, moment, plan_id, answer)
select '00000000-0000-0000-0000-00000000aa03', 'confirmed', p.id, null
from public.plans p where p.short_code = 'pnanba';

select is(
  (select array[shown, tapped, unanswered] from analytics.nudge_conversion where moment = 'confirmed'),
  array[2::bigint, 1::bigint, 1::bigint],
  'a nudge counts as shown when the row exists and as answered only when somebody answered'
);

update public.meetup_confirmations set chased_answer = 'one' where id = :'march';
select is(
  (select confirmations from analytics.chasing
   where chased_answer = 'one' and month = date_trunc('month', timestamptz '2026-03-05T00:00:00Z')),
  1::bigint,
  'the chasing survey is counted by answer, because a chased reply looks like any other reply'
);

select is(
  (select activated_within_7_days from analytics.funnel_by_circle
   where circle_id = pg_temp.circle()),
  true,
  'a circle that confirmed three days after it was made activated, in §11.2''s sense'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000aa04');
select public.create_circle('Never Met', 'sky', 'Australia/Melbourne', 'key-never');
select pg_temp.act_as_postgres();
select is(
  (select activated_within_7_days from analytics.funnel_by_circle f
   join public.circles c on c.id = f.circle_id where c.creation_key = 'key-never'),
  false,
  'and a circle that has confirmed nothing reads false rather than null, so counting the failures finds them'
);

-- The two views nothing else asserts. `plan_timings` is the §11.4 gate about
-- how long a reply takes; `reattach_rate` is the one about getting back in.
-- In a month of its own, because the seed's circles make plans too and a
-- median over a month they share is a median of somebody else's numbers.
update public.plans set created_at = timestamptz '2026-04-10T02:00:00Z'
where short_code = 'pnanaa';
insert into public.plan_responses (plan_id, revision, user_id, status, submitted_at)
select p.id, p.revision, '00000000-0000-0000-0000-00000000aa02', 'flexible',
       p.created_at + interval '90 seconds'
from public.plans p where p.short_code = 'pnanaa';

select is(
  (select median_seconds_to_first_response::integer from analytics.plan_timings
   where month = timestamp '2026-04-01'),
  90,
  'the median wait for a first reply is measured from the plan, in the circle''s own month'
);

-- §11.4's gate is the *other* wait: "median response after link open". The
-- organiser may have made the plan the night before, and none of that is time
-- the member spent deciding. It needs an event, because tapping a link leaves
-- no row behind.
select pg_temp.act_as_service();
select public.record_events(jsonb_build_array(
  jsonb_build_object(
    'event_id', '00000000-0000-0000-0000-0000000000e6',
    'event_name', 'availability_started', 'schema_version', 1,
    'user_id', '00000000-0000-0000-0000-00000000aa02',
    'plan_id', (select id from public.plans where short_code = 'pnanaa'),
    'properties', '{}'::jsonb,
    'occurred_at', (select created_at + interval '60 seconds' from public.plans
                    where short_code = 'pnanaa'))
));

select pg_temp.act_as_postgres();
select is(
  (select median_seconds_from_open_to_response::integer from analytics.plan_timings
   where month = timestamp '2026-04-01'),
  30,
  'and the gate is measured from the tap, not from whenever the organiser made the plan'
);

-- Over every answer, not the first one per plan. Taking one response a plan
-- made this the median of the *fastest person in each group*: ten seconds and
-- ten minutes reported ten seconds.
select pg_temp.act_as_postgres();
insert into public.plan_responses (plan_id, revision, user_id, status, submitted_at)
select p.id, p.revision, '00000000-0000-0000-0000-00000000aa03', 'flexible',
       p.created_at + interval '11 minutes'
from public.plans p where p.short_code = 'pnanaa';

select pg_temp.act_as_service();
select public.record_events(jsonb_build_array(
  jsonb_build_object(
    'event_id', '00000000-0000-0000-0000-0000000000e7',
    'event_name', 'availability_started', 'schema_version', 1,
    'user_id', '00000000-0000-0000-0000-00000000aa03',
    'plan_id', (select id from public.plans where short_code = 'pnanaa'),
    'properties', '{}'::jsonb,
    'occurred_at', (select created_at + interval '60 seconds' from public.plans
                    where short_code = 'pnanaa'))
));

select pg_temp.act_as_postgres();
select is(
  (select median_seconds_from_open_to_response::integer from analytics.plan_timings
   where month = timestamp '2026-04-01'),
  315,
  'and a second, slower answer moves it: the median is of answers, not of plans'
);

select is(
  (select array[median_seconds_to_first_response::integer,
                median_seconds_to_last_response::integer]
   from analytics.plan_timings where month = timestamp '2026-04-01'),
  array[90, 660],
  'first and last are both reported, because §11.2 asks for both'
);

select pg_temp.act_as_service();
select public.record_events(jsonb_build_array(
  jsonb_build_object('event_id', '00000000-0000-0000-0000-0000000000e4',
    'event_name', 'session_missing_on_return', 'schema_version', 1,
    'properties', '{}'::jsonb, 'occurred_at', '2026-03-02T00:00:00Z'),
  jsonb_build_object('event_id', '00000000-0000-0000-0000-0000000000e5',
    'event_name', 'member_reattached', 'schema_version', 1,
    'properties', jsonb_build_object('source', 'email'),
    'occurred_at', '2026-03-02T00:00:00Z')
));

select pg_temp.act_as_postgres();
select is(
  (select array[sessions_missing, reattached, reattached_from_email, reattached_from_list]
   from analytics.reattach_rate where month = timestamptz '2026-03-01T00:00:00Z'),
  array[1::bigint, 1::bigint, 1::bigint, 0::bigint],
  'and a return with no session is counted against the reattachment that answered it, by route'
);

-- Round 4: the north star counts meetups *per activated circle*, and §11.2 says
-- activated means "confirms first meetup within 7 days". A circle that took
-- three weeks to get going is not in the denominator — and its meetups must not
-- be in the numerator either, or the rate is one no circle actually achieves.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa04');
select public.create_circle('Slow Crew', 'sky', 'Australia/Melbourne', 'key-slow');
select pg_temp.act_as_postgres();
update public.circles set created_at = timestamptz '2026-03-01T00:00:00Z'
where creation_key = 'key-slow';

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select c.id, 'named', 'confirmed', '00000000-0000-0000-0000-00000000aa04',
  'Eventually', 'Australia/Melbourne', date '2026-03-25', date '2026-03-28',
  1050, 1350, 120, 2, timestamptz '2026-03-25T05:00:00Z', 'pnanbs'
from public.circles c where c.creation_key = 'key-slow';

insert into public.meetup_confirmations (
  plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by,
  status, confirmed_at
)
select p.id, 1, '2026-03-25T08:30:00+00:00',
  timestamptz '2026-03-25T08:30:00Z', timestamptz '2026-03-25T10:30:00Z',
  array['00000000-0000-0000-0000-00000000aa04'::uuid],
  '00000000-0000-0000-0000-00000000aa04', 'active', timestamptz '2026-03-25T00:00:00Z'
from public.plans p where p.short_code = 'pnanbs';

insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '00000000-0000-0000-0000-00000000aa04' from public.plans where short_code = 'pnanbs';

insert into public.outcome_reports (confirmation_id, reported_by, outcome, reported_at)
select mc.id, '00000000-0000-0000-0000-00000000aa04', 'happened', timestamptz '2026-03-26T09:00:00Z'
from public.meetup_confirmations mc
join public.plans p on p.id = mc.plan_id where p.short_code = 'pnanbs';

select is(
  (select array[activated_circles, happened_reported] from analytics.north_star_monthly
   where month = timestamp '2026-03-01'),
  array[1::bigint, 2::bigint],
  'a circle that took three weeks to get going is in neither half of the rate'
);

-- ---------------------------------------------------------------------------
-- Who may read any of it.
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'analytics.north_star_monthly', 'select')
  and not has_table_privilege('anon', 'analytics.north_star_monthly', 'select')
  and not has_table_privilege('service_role', 'analytics.funnel_by_circle', 'select'),
  'the views are readable by no role at all: the only way in is the function'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select throws_ok(
  'select public.founder_summary()',
  '42501',
  null,
  'and the function refuses a signed-in user who is not on the allowlist — owning a circle is not being the founder'
);

select pg_temp.act_as_postgres();
insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-00000000aa01');

select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select is(
  (select count(*)::integer from jsonb_object_keys(public.founder_summary())),
  6,
  'somebody on the allowlist gets all six views in one answer'
);
-- The seed has a circle of its own that met this month, so this asks about the
-- month the fixture built rather than about the whole table.
select is(
  (select array[e ->> 'happened_reported', e ->> 'happened_corroborated']
   from jsonb_array_elements(public.founder_summary() -> 'north_star_monthly') e
   where e ->> 'month' like '2026-03%'),
  array['2', '1'],
  'and the numbers in it are the views'' own'
);
select is(
  (select public.founder_summary()::text ~* 'Maya|Priya|Sunday Crew|Catch up'),
  false,
  'with no person and no circle named anywhere in it: the founder reads counts, not people'
);

select * from finish();
rollback;
