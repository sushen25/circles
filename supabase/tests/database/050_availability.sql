-- Availability and scheduling, from the outside.
--
-- 050 because 040 was the candidate-guard tripwire, which this ticket tripped
-- and removed: `public.candidates` exists now, and the last section of this
-- file is the assertion that replaced it.
--
-- The claim under test is spec §5.5's privacy line, made structural: "Your
-- friends will only see a combined result. They won't see your calendar or a
-- personal schedule view." So the assertions that matter most are the ones
-- made as somebody *else*.

begin;
select plan(50);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous, jsonb_build_object('is_anonymous', anonymous),
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

-- Maya organises, Priya and Tom answer, Nobody is in another circle entirely.
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a4', 'Nobody');

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-avail');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where name = 'Sunday Crew';
grant select on t to anon, authenticated, service_role;

-- Cast, because a `union all` of quoted literals resolves them to text before
-- the uuid column ever sees them.
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000002a2'::uuid, 'Priya' from t
union all
select circle_id, '00000000-0000-0000-0000-0000000002a3'::uuid, 'Tom' from t;

-- A plan in `collecting`, Thursday 17 to Sunday 20 September 2099, 17:30–22:30
-- Melbourne, two hours, everybody but Nobody addressed. In 2099 so that "now"
-- is before the deadline whenever these tests run, and the deadline itself is
-- before the last possible start — the trigger from 0003 refuses one that is
-- not, and did.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000002a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 3, timestamptz '2099-09-20T10:00:00Z', 'pnavaa'
from t;
create temporary table tp as select id as plan_id from public.plans where short_code = 'pnavaa';
grant select on tp to anon, authenticated, service_role;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, u from tp, unnest(array[
  '00000000-0000-0000-0000-0000000002a1'::uuid,
  '00000000-0000-0000-0000-0000000002a2'::uuid,
  '00000000-0000-0000-0000-0000000002a3'::uuid
]) as u;

-- 18:30–20:30 Melbourne on the 17th, as instants.
create or replace function pg_temp.win(day text, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::date::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

-- ---------------------------------------------------------------------------
-- The shape.
-- ---------------------------------------------------------------------------

select has_table('public', 'plan_responses', 'plan_responses exists');
select has_table('public', 'willing_windows', 'willing_windows exists');
select has_table('public', 'candidate_sets', 'candidate_sets exists');
select has_table('public', 'candidates', 'candidates exists');
select has_view('public', 'response_summaries', 'response_summaries exists');
select has_function('public', 'replace_response', array['uuid', 'text', 'jsonb', 'boolean'],
  'replace_response exists');

select ok(
  not has_table_privilege('authenticated', 'public.plan_responses', 'insert')
  and not has_table_privilege('authenticated', 'public.plan_responses', 'update')
  and not has_table_privilege('authenticated', 'public.plan_responses', 'delete'),
  'no client writes a response directly — replace_response is the path (ADR 0013)'
);
select ok(
  not has_table_privilege('authenticated', 'public.willing_windows', 'insert'),
  'nor a window'
);
select ok(
  not has_table_privilege('service_role', 'public.plan_responses', 'insert'),
  'and neither does the service role: answers come from members'
);

-- ---------------------------------------------------------------------------
-- Answering.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a2');
select lives_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(%L::jsonb, %L::jsonb))$$,
    (select plan_id from tp),
    pg_temp.win('2099-09-17', 1110, 1230),
    pg_temp.win('2099-09-19', 1140, 1260)),
  'Priya answers with two windows'
);
select is(
  (select count(*)::integer from public.willing_windows),
  2,
  'and can read both of them back'
);
select is(
  (select status from public.plan_responses where user_id = '00000000-0000-0000-0000-0000000002a2'),
  'windows',
  'as a windows response'
);

-- ---------------------------------------------------------------------------
-- What a window may be.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-17', 1117, 1230)),
  '23514',
  null,
  '18:37 is not a half hour'
);
select throws_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(%L::jsonb, %L::jsonb))$$,
    (select plan_id from tp),
    pg_temp.win('2099-09-17', 1110, 1230),
    pg_temp.win('2099-09-17', 1170, 1290)),
  '23P01',
  null,
  'two windows of one answer cannot overlap — the exclusion constraint, not a trigger'
);
select throws_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-21', 1110, 1230)),
  '23514',
  null,
  'a window on a day outside the plan is refused'
);
select throws_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-17', 960, 1080)),
  '23514',
  null,
  'and one before the daily band opens'
);
select throws_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-17', 1230, 1110)),
  '23514',
  null,
  'and one that ends before it starts'
);

-- Alignment is judged in the plan's zone. Kathmandu is UTC+05:45, so 09:00 there
-- is 03:15Z: judged in UTC it would be refused, and 09:15 local would pass.
select pg_temp.act_as_postgres();
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000002a1',
  'Kathmandu', 'Asia/Kathmandu', date '2099-09-17', date '2099-09-20',
  540, 1350, 120, 3, timestamptz '2099-09-20T10:00:00Z', 'pnavkk'
from t;
insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '00000000-0000-0000-0000-0000000002a2' from public.plans where short_code = 'pnavkk';

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a2');
select lives_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(jsonb_build_object(
      'start', timestamptz '2099-09-17T03:15:00Z', 'end', timestamptz '2099-09-17T04:15:00Z')))$$,
    (select id from public.plans where short_code = 'pnavkk')),
  '09:00–10:00 in Kathmandu is 03:15–04:15Z, and is on the half hour where it counts'
);
select throws_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(jsonb_build_object(
      'start', timestamptz '2099-09-17T03:30:00Z', 'end', timestamptz '2099-09-17T04:30:00Z')))$$,
    (select id from public.plans where short_code = 'pnavkk')),
  '23514',
  null,
  'while 03:30Z — a UTC half hour — is 09:15 there, and refused'
);

-- ---------------------------------------------------------------------------
-- An answer is the whole answer.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a2');
select lives_ok(
  format($$select public.replace_response('%s', 'windows', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-18', 1110, 1230)),
  'answering again replaces the previous answer'
);
select is(
  (select count(*)::integer from public.willing_windows ww
   join public.plan_responses r on r.id = ww.response_id
   where r.plan_id = (select plan_id from tp)),
  1,
  'so the two earlier windows are gone and the new one stands'
);

select lives_ok(
  format($$select public.replace_response('%s', 'flexible')$$, (select plan_id from tp)),
  'switching to "I''m easy"'
);
select is(
  (select count(*)::integer from public.willing_windows ww
   join public.plan_responses r on r.id = ww.response_id
   where r.plan_id = (select plan_id from tp)),
  0,
  'drops the windows: a flexible answer carries none, and leaving them would be availability the person withdrew'
);
select throws_ok(
  format($$select public.replace_response('%s', 'not_this_time', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-17', 1110, 1230)),
  '23514',
  null,
  'and a not-this-time with a window attached is refused outright'
);
select throws_ok(
  format($$select public.replace_response('%s', 'windows', '[]'::jsonb)$$, (select plan_id from tp)),
  '23514',
  null,
  'as is a windows answer with no windows'
);

-- ---------------------------------------------------------------------------
-- Who may answer, and when.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a4');
select throws_ok(
  format($$select public.replace_response('%s', 'flexible')$$, (select plan_id from tp)),
  '42501',
  null,
  'somebody outside the circle cannot answer, and learns nothing about the plan from the refusal'
);

-- Addressed, not merely present. A member who joined after the plan was made
-- is not a participant until something adds them (spec §9).
select pg_temp.act_as_postgres();
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a5', 'Newcomer');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000002a5', 'Newcomer' from t;
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a5');
select throws_ok(
  format($$select public.replace_response('%s', 'flexible')$$, (select plan_id from tp)),
  '42501',
  null,
  'a member the plan was not addressed to cannot answer it'
);

-- Replies close at the deadline (spec §5.5) …
select pg_temp.act_as_postgres();
-- A date that is genuinely past, whenever this runs. Everything else in this
-- file lives in 2099 so the suite does not start failing on 20 September 2026,
-- when the plan's dates would have slipped behind the clock.
update public.plans set response_deadline = timestamptz '2020-09-01T00:00:00Z'
where id = (select plan_id from tp);
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a3');
select throws_ok(
  format($$select public.replace_response('%s', 'flexible')$$, (select plan_id from tp)),
  '23514',
  null,
  'after the deadline, replies are closed'
);
select pg_temp.act_as_postgres();
update public.plans set response_deadline = timestamptz '2099-09-20T10:00:00Z'
where id = (select plan_id from tp);

-- … and at confirmation.
select pg_temp.act_as_postgres();
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'confirmed', '00000000-0000-0000-0000-0000000002a1',
  'Done', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 3, timestamptz '2099-09-20T10:00:00Z', 'pnavcc'
from t;
insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '00000000-0000-0000-0000-0000000002a3' from public.plans where short_code = 'pnavcc';
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a3');
select throws_ok(
  format($$select public.replace_response('%s', 'flexible')$$,
    (select id from public.plans where short_code = 'pnavcc')),
  '23514',
  null,
  'a confirmed plan takes no more answers'
);

-- ---------------------------------------------------------------------------
-- What one member may learn about another's answer.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a3');
select public.replace_response((select plan_id from tp), 'windows',
  jsonb_build_array(pg_temp.win('2099-09-17', 1110, 1230)));

-- Scoped to this plan: Priya also answered the Kathmandu plan above with a
-- window, and an unscoped count would report her own row as a leak.
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a2');
select is(
  (select count(*)::integer from public.willing_windows ww
   join public.plan_responses r on r.id = ww.response_id
   where r.plan_id = (select plan_id from tp)),
  0,
  'Priya (now flexible) reads no windows on this plan — Tom''s are not hers'
);
select is(
  (select count(*)::integer from public.plan_responses where plan_id = (select plan_id from tp)),
  1,
  'and only her own response row'
);
select is(
  (select count(*)::integer from public.plan_responses
   where plan_id = (select plan_id from tp) and user_id <> '00000000-0000-0000-0000-0000000002a2'),
  0,
  'never anybody else''s'
);
select is(
  (select array_agg(status order by user_id) from public.response_summaries
   where plan_id = (select plan_id from tp)),
  array['flexible', 'windows'],
  'but sees who has answered and how through the summary'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_name = 'response_summaries' and column_name in ('starts_at', 'ends_at')),
  0,
  'and the summary has no column a window could travel in'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a4');
select is(
  (select count(*)::integer from public.response_summaries),
  0,
  'somebody outside the circle sees no summaries'
);

-- ---------------------------------------------------------------------------
-- input_version moves with every answer.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select input_version as before_iv from public.plans where id = (select plan_id from tp) \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a2');
select public.replace_response((select plan_id from tp), 'windows',
  jsonb_build_array(pg_temp.win('2099-09-17', 1110, 1230)));
select pg_temp.act_as_postgres();
select cmp_ok(
  (select input_version from public.plans where id = (select plan_id from tp)),
  '>', :before_iv,
  'an answer bumps the plan''s input_version — the stale-result check has something to compare'
);

-- ---------------------------------------------------------------------------
-- Candidate sets: the combined result, readable by the circle.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();
select lives_ok(
  format($$insert into public.candidate_sets
      (plan_id, revision, input_version, scoring_version, input_hash,
       starts_considered, eligible_count, responded_count, active_member_count)
    select id, revision, input_version, scoring_version, 'abc', 40, 1, 2, 3
    from public.plans where id = '%s'$$, (select plan_id from tp)),
  'the service role writes a candidate set'
);
create temporary table tcs as select id as set_id from public.candidate_sets;
grant select on tcs to anon, authenticated, service_role;

select lives_ok(
  format($$insert into public.candidates
      (candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
       explicit_count, flexible_count, explanation_code, explanation_count)
    values ('%s', false, 1, timestamptz '2099-09-17T08:30:00Z', timestamptz '2099-09-17T10:30:00Z',
      array['00000000-0000-0000-0000-0000000002a2', '00000000-0000-0000-0000-0000000002a3']::uuid[],
      1, 1, 'best_attendance', 2)$$, (select set_id from tcs)),
  'and an eligible candidate'
);
select lives_ok(
  format($$insert into public.candidates
      (candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
       explicit_count, flexible_count, explanation_code, explanation_count, near_miss_reason)
    values ('%s', true, 1, timestamptz '2099-09-18T08:30:00Z', timestamptz '2099-09-18T10:30:00Z',
      array[]::uuid[], 0, 0, 'closest', 0, '{"kind":"quorum_short","by":3}'::jsonb)$$,
    (select set_id from tcs)),
  'and a near-miss with nobody at all (ADR 0011)'
);
select throws_ok(
  format($$insert into public.candidates
      (candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
       explicit_count, flexible_count, explanation_code, explanation_count)
    values ('%s', false, 2, timestamptz '2099-09-19T08:30:00Z', timestamptz '2099-09-19T10:30:00Z',
      array[]::uuid[], 0, 0, 'also_n_later', 0)$$, (select set_id from tcs)),
  '23514',
  null,
  'but an eligible option with nobody is not an option'
);
select throws_ok(
  format($$insert into public.candidates
      (candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
       explicit_count, flexible_count, explanation_code, explanation_count)
    values ('%s', false, 2, timestamptz '2099-09-17T08:30:00Z', timestamptz '2099-09-17T10:30:00Z',
      array['00000000-0000-0000-0000-0000000002a2']::uuid[], 1, 0, 'also_n_later', 1)$$,
    (select set_id from tcs)),
  '23505',
  null,
  'and one start appears once per set — its identity is its start'
);
select throws_ok(
  format($$insert into public.candidates
      (candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
       explicit_count, flexible_count, explanation_code, explanation_count)
    values ('%s', false, 4, timestamptz '2099-09-20T08:30:00Z', timestamptz '2099-09-20T10:30:00Z',
      array['00000000-0000-0000-0000-0000000002a2']::uuid[], 1, 0, 'also_n_later', 1)$$,
    (select set_id from tcs)),
  '23514',
  null,
  'at most three of each kind'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a3');
select is((select count(*)::integer from public.candidates), 2, 'a member reads the whole set');
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a4');
select is((select count(*)::integer from public.candidates), 0, 'an outsider reads none of it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a3');
select ok(
  not has_table_privilege('authenticated', 'public.candidates', 'insert'),
  'and no client writes one'
);

-- ---------------------------------------------------------------------------
-- The candidate guard checks eligibility now, not presence.
--
-- This replaces 040_candidate_guard_dependency.sql, which tripped for it.
-- ---------------------------------------------------------------------------

-- Through the state machine, because 0003's guard refuses a bare update to
-- `state` even from postgres — and did, when this fixture first tried it.
select pg_temp.act_as_postgres();
select planning.transition_plan((select plan_id from tp), 'candidates_ready',
  '00000000-0000-0000-0000-0000000002a1');

select throws_ok(
  format($$select planning.transition_plan('%s', 'confirm', '%s', '{"candidate_id":"x"}'::jsonb)$$,
    (select plan_id from tp), '00000000-0000-0000-0000-0000000002a1'),
  'P0001',
  'needs_candidate',
  'a supplied id is not enough: it has to name an eligible candidate'
);
select throws_ok(
  format($$select planning.transition_plan('%s', 'confirm', '%s',
      '{"candidate_id":"2099-09-18T08:30:00.000Z"}'::jsonb)$$,
    (select plan_id from tp), '00000000-0000-0000-0000-0000000002a1'),
  'P0001',
  'needs_candidate',
  'a near-miss is on the screen but not on offer'
);

-- Make the set stale for real: an answer *after* it was written bumps the
-- plan's input_version past the set's. The first version of this test assumed
-- the earlier answers had done that, but the set was written after them —
-- the confirm went through, and the assertion had proved nothing.
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a2');
select public.replace_response((select plan_id from tp), 'flexible');
select pg_temp.act_as_postgres();
select cmp_ok(
  (select input_version from public.plans where id = (select plan_id from tp)),
  '>',
  (select input_version from public.candidate_sets where id = (select set_id from tcs)),
  'the plan has moved past the set it was computed for'
);
select throws_ok(
  format($$select planning.transition_plan('%s', 'confirm', '%s',
      '{"candidate_id":"2099-09-17T08:30:00.000Z"}'::jsonb)$$,
    (select plan_id from tp), '00000000-0000-0000-0000-0000000002a1'),
  'P0001',
  'needs_candidate',
  'a set computed before the latest answer names people who may no longer be free'
);

-- Bring the set up to date and it goes through.
update public.candidate_sets cs
set input_version = p.input_version
from public.plans p
where p.id = cs.plan_id and cs.id = (select set_id from tcs);
select is(
  (select state from planning.transition_plan((select plan_id from tp), 'confirm',
    '00000000-0000-0000-0000-0000000002a1', '{"candidate_id":"2099-09-17T08:30:00.000Z"}'::jsonb)),
  'confirmed',
  'and an eligible candidate from the current set confirms'
);

select * from finish();
rollback;
