-- Confirmation and outcomes, from the outside.
--
-- The two invariants the north-star metric rests on (architecture §6.2): one
-- active confirmation per plan revision, and `happened` the only outcome that
-- moves `last_met_at`. Both are tested as the database, because both are the
-- database's — and the rest is tested as the people who use it.

begin;
select plan(51);

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

-- Maya organises, Priya and Tom are members, Nobody is outside the circle.
select pg_temp.make_user('00000000-0000-0000-0000-0000000003a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000003a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000003a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000003a4', 'Nobody');

select pg_temp.act_as('00000000-0000-0000-0000-0000000003a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-confirm');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where name = 'Sunday Crew';
grant select on t to anon, authenticated, service_role;
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000003a2'::uuid, 'Priya' from t
union all
select circle_id, '00000000-0000-0000-0000-0000000003a3'::uuid, 'Tom' from t;

-- A confirmed plan whose meetup is in the *past* — 2020 — so that outcomes can
-- be reported and retrospective attendance is allowed; and one whose meetup is
-- in 2099, so that the same things are refused. Both built by hand: making a
-- confirmation is confirm-meetup's job (S1-17) and this ticket is the tables.
create or replace function pg_temp.make_confirmed_plan(code text, day date)
returns uuid language plpgsql as $$
declare
  new_id uuid;
begin
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  )
  select circle_id, 'named', 'confirmed', '00000000-0000-0000-0000-0000000003a1',
    'Catch up', 'Australia/Melbourne', day, day + 3, 1050, 1350, 120, 2,
    (day::timestamp + interval '1 day') at time zone 'Australia/Melbourne', code
  from t
  returning id into new_id;

  insert into public.plan_participants (plan_id, revision, user_id)
  select new_id, 1, u from unnest(array[
    '00000000-0000-0000-0000-0000000003a1'::uuid,
    '00000000-0000-0000-0000-0000000003a2'::uuid,
    '00000000-0000-0000-0000-0000000003a3'::uuid
  ]) as u;
  return new_id;
end;
$$;

create or replace function pg_temp.confirm(plan uuid, day date)
returns uuid language plpgsql as $$
declare
  new_id uuid;
begin
  insert into public.meetup_confirmations
    (plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, place_name, confirmed_by)
  values (
    plan, 1, (day::timestamp + interval '18 hours 30 minutes')::text,
    (day::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
    (day::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
    array['00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000003a2']::uuid[],
    'Hope St Radio', '00000000-0000-0000-0000-0000000003a1'
  )
  returning id into new_id;
  -- Stamped in the past, so a test can tell "left alone" from "set to now()"
  -- inside a transaction where now() never moves.
  insert into public.attendance (confirmation_id, user_id, status, updated_at)
  values
    (new_id, '00000000-0000-0000-0000-0000000003a1', 'going', '2000-01-01T00:00:00Z'),
    (new_id, '00000000-0000-0000-0000-0000000003a2', 'going', '2000-01-01T00:00:00Z'),
    (new_id, '00000000-0000-0000-0000-0000000003a3', 'unknown', '2000-01-01T00:00:00Z');
  return new_id;
end;
$$;

select pg_temp.make_confirmed_plan('pncfpp', date '2020-09-17') as past_plan \gset
select pg_temp.confirm(:'past_plan', date '2020-09-17') as past_conf \gset
select pg_temp.make_confirmed_plan('pncfff', date '2099-09-17') as future_plan \gset
select pg_temp.confirm(:'future_plan', date '2099-09-17') as future_conf \gset

-- ---------------------------------------------------------------------------
-- The shape.
-- ---------------------------------------------------------------------------

select has_table('public', 'meetup_confirmations', 'meetup_confirmations exists');
select has_table('public', 'attendance', 'attendance exists');
select has_table('public', 'outcome_reports', 'outcome_reports exists');
select ok(
  not has_table_privilege('authenticated', 'public.meetup_confirmations', 'insert'),
  'no client inserts a confirmation — confirm-meetup does'
);
select ok(
  not has_column_privilege('service_role', 'public.meetup_confirmations', 'status', 'update'),
  'and not even the service role moves a confirmation''s status: the triggers do'
);

-- ---------------------------------------------------------------------------
-- One active confirmation per revision.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select throws_ok(
  format($$select pg_temp.confirm('%s', date '2099-09-18')$$, :'future_plan'),
  '23505',
  null,
  'a second active confirmation for the same revision is refused — by the index, under any concurrency'
);

update public.meetup_confirmations
set status = 'superseded', superseded_at = now(), superseded_reason = 'reopen'
where id = :'future_conf';
select lives_ok(
  format($$select pg_temp.confirm('%s', date '2099-09-18')$$, :'future_plan'),
  'and allowed once the first is superseded'
);
select is(
  (select starts_at from public.meetup_confirmations where id = :'future_conf'),
  timestamptz '2099-09-17T08:30:00Z',
  'the superseded one keeps the time it held — "Thursday is off the table" stays true'
);
select throws_ok(
  format($$update public.meetup_confirmations set status = 'active' where id = '%s'$$, :'future_conf'),
  '23514',
  null,
  'and cannot be made active again with its superseded fields still set'
);
-- Re-point `future_conf` at the live one for the tests below.
select id as future_conf from public.meetup_confirmations
where plan_id = :'future_plan' and status = 'active' \gset

-- ---------------------------------------------------------------------------
-- Leaving `confirmed` takes the confirmation with it.
-- ---------------------------------------------------------------------------

select pg_temp.make_confirmed_plan('pncfrr', date '2099-10-01') as reopen_plan \gset
select pg_temp.confirm(:'reopen_plan', date '2099-10-01') as reopen_conf \gset
select planning.transition_plan(:'reopen_plan', 'reopen', '00000000-0000-0000-0000-0000000003a1');
select is(
  (select status from public.meetup_confirmations where id = :'reopen_conf'),
  'superseded',
  'a reopen supersedes the active confirmation in the same statement'
);
select is(
  (select superseded_reason from public.meetup_confirmations where id = :'reopen_conf'),
  'reopen',
  'and says why'
);

select pg_temp.make_confirmed_plan('pncfcc', date '2099-10-08') as cancel_plan \gset
select pg_temp.confirm(:'cancel_plan', date '2099-10-08') as cancel_conf \gset
select planning.transition_plan(:'cancel_plan', 'cancel', '00000000-0000-0000-0000-0000000003a1',
  '{"cancel_note":"Rain"}'::jsonb);
select is(
  (select status from public.meetup_confirmations where id = :'cancel_conf'),
  'cancelled',
  'a cancel cancels it'
);

-- ---------------------------------------------------------------------------
-- Attendance: what a member may say, and when.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000003a2');
select lives_ok(
  format($$update public.attendance set status = 'cant'
    where confirmation_id = '%s' and user_id = '00000000-0000-0000-0000-0000000003a2'$$,
    :'future_conf'),
  'Priya can say she cannot make it after all'
);
select is(
  (select status from public.attendance
   where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'),
  'cant',
  'and it sticks'
);

update public.attendance set status = 'going'
where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a3';
select is(
  (select status from public.attendance
   where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a3'),
  'unknown',
  'but cannot answer for Tom: the update matches no row'
);

select throws_ok(
  format($$update public.attendance set status = 'was_there'
    where confirmation_id = '%s' and user_id = '00000000-0000-0000-0000-0000000003a2'$$,
    :'future_conf'),
  '23514',
  'attendance_too_early',
  '"I was there" before the evening has happened is not an early answer, it is a false one'
);
select throws_ok(
  format($$update public.attendance set status = 'unknown'
    where confirmation_id = '%s' and user_id = '00000000-0000-0000-0000-0000000003a2'$$,
    :'future_conf'),
  '23514',
  'attendance_not_reversible',
  '"has not said" is not something you can say'
);

select ok(
  (select updated_at > timestamptz '2000-01-02' from public.attendance
   where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'),
  'a change of mind is stamped'
);

-- Idempotent: the same choice twice is not a fresh answer.
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a1');
update public.attendance set status = 'going'
where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a1';
select is(
  (select updated_at from public.attendance
   where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a1'),
  timestamptz '2000-01-01T00:00:00Z',
  'a repeat of the same choice leaves updated_at alone — a duplicate tap is not a change of mind'
);

-- After the meetup, the other question.
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a2');
select lives_ok(
  format($$update public.attendance set status = 'was_there'
    where confirmation_id = '%s' and user_id = '00000000-0000-0000-0000-0000000003a2'$$,
    :'past_conf'),
  'after the meetup, "I was there" is allowed'
);
select throws_ok(
  format($$update public.attendance set status = 'going'
    where confirmation_id = '%s' and user_id = '00000000-0000-0000-0000-0000000003a2'$$,
    :'past_conf'),
  '23514',
  'attendance_not_reversible',
  'and there is no way back from an answer about the past to a promise about the future'
);
select lives_ok(
  format($$update public.attendance set status = 'missed'
    where confirmation_id = '%s' and user_id = '00000000-0000-0000-0000-0000000003a2'$$,
    :'past_conf'),
  'while a mis-tap on the WasThere screen can be corrected'
);

-- Nobody is told who came.
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a1');
select is(
  (select count(*)::integer from public.attendance
   where confirmation_id = :'past_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'),
  0,
  'Priya''s answer about the past is not Maya''s to read — not even the organiser''s'
);
select is(
  (select count(*)::integer from public.attendance
   where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'),
  1,
  'while whether she is coming to the next one is the circle''s business'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a2');
select is(
  (select status from public.attendance
   where confirmation_id = :'past_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'),
  'missed',
  'and she can still read her own'
);

-- Somebody the plan was not addressed to.
select pg_temp.act_as_postgres();
select pg_temp.make_user('00000000-0000-0000-0000-0000000003a5', 'Newcomer');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000003a5', 'Newcomer' from t;
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a5');
select throws_ok(
  format($$insert into public.attendance (confirmation_id, user_id, status)
    values ('%s', '00000000-0000-0000-0000-0000000003a5', 'going')$$, :'future_conf'),
  '23514',
  'attendance_not_a_participant',
  'a member the plan was not addressed to cannot mark themselves going'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000003a4');
select is((select count(*)::integer from public.attendance), 0, 'an outsider reads no attendance');
select is((select count(*)::integer from public.meetup_confirmations), 0, 'and no confirmations');

-- ---------------------------------------------------------------------------
-- Outcomes, and `last_met_at`.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
update public.circles set last_met_at = null where id = (select circle_id from t);

-- Too early.
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a1');
select throws_ok(
  format($$select public.report_outcome('%s', 'happened')$$, :'future_conf'),
  '23514',
  'outcome_too_early',
  'the question has no answer before the evening has happened'
);

-- Not the organiser.
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a2');
select throws_ok(
  format($$select public.report_outcome('%s', 'happened')$$, :'past_conf'),
  '42501',
  null,
  'a member cannot file the outcome — that is the organiser''s, and members say "I was there" instead'
);
select throws_ok(
  format($$insert into public.outcome_reports (confirmation_id, reported_by, outcome)
    values ('%s', '00000000-0000-0000-0000-0000000003a2', 'happened')$$, :'past_conf'),
  '42501',
  null,
  'and nobody writes outcome_reports directly — report_outcome is the door'
);

-- Not `happened`: nothing moves.
select pg_temp.act_as_postgres();
select pg_temp.make_confirmed_plan('pncfnn', date '2020-08-01') as ns_plan \gset
select pg_temp.confirm(:'ns_plan', date '2020-08-01') as ns_conf \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a1');
select lives_ok(
  format($$select public.report_outcome('%s', 'not_sure', null, false)$$, :'ns_conf'),
  'the organiser reports "not sure"'
);
select is(
  (select reported_by from public.outcome_reports where confirmation_id = :'ns_conf'),
  '00000000-0000-0000-0000-0000000003a1'::uuid,
  'as themselves — the reporter is auth.uid(), not a parameter'
);
select is(
  (select last_met_at from public.circles where id = (select circle_id from t)),
  null,
  'and last_met_at does not move for not_sure'
);
select is(
  (select status from public.meetup_confirmations where id = :'ns_conf'),
  'completed',
  'but the confirmation is closed'
);
select is(
  (select state from public.plans where id = :'ns_plan'),
  'completed',
  'and the plan completed, through the state machine'
);

-- `happened`: it moves, to the time the circle met.
select lives_ok(
  format($$select public.report_outcome('%s', 'happened', 'Great night')$$, :'past_conf'),
  'the organiser reports it happened'
);
select is(
  (select last_met_at from public.circles where id = (select circle_id from t)),
  timestamptz '2020-09-17T08:30:00Z',
  'last_met_at is the confirmation''s start, not now()'
);

-- And never backwards.
select pg_temp.act_as_postgres();
select pg_temp.make_confirmed_plan('pncfqq', date '2020-07-01') as old_plan \gset
select pg_temp.confirm(:'old_plan', date '2020-07-01') as old_conf \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a1');
select lives_ok(
  format($$select public.report_outcome('%s', 'happened')$$, :'old_conf'),
  'an older meetup is reported late'
);
select is(
  (select last_met_at from public.circles where id = (select circle_id from t)),
  timestamptz '2020-09-17T08:30:00Z',
  'and last_met_at stays where the later meetup put it — cadence would otherwise call the circle overdue'
);

-- `cancelled` closes it as cancelled.
select pg_temp.act_as_postgres();
select pg_temp.make_confirmed_plan('pncfxx', date '2020-06-01') as x_plan \gset
select pg_temp.confirm(:'x_plan', date '2020-06-01') as x_conf \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a1');
select public.report_outcome(:'x_conf', 'cancelled');
select is(
  (select status from public.meetup_confirmations where id = :'x_conf'),
  'cancelled',
  'a cancelled outcome closes the confirmation as cancelled'
);
select pg_temp.act_as_postgres();
select throws_ok(
  format($$insert into public.outcome_reports (confirmation_id, reported_by, outcome)
    values ('%s', '00000000-0000-0000-0000-0000000003a2', 'happened')$$, :'x_conf'),
  '23514',
  'confirmation_not_active',
  'and it cannot then be reported on again, by anyone'
);

-- A removed organiser cannot report. The organiser guard is the state
-- machine's, and it checks membership too.
select pg_temp.act_as_postgres();
select pg_temp.make_confirmed_plan('pncfgg', date '2020-05-01') as gone_plan \gset
select pg_temp.confirm(:'gone_plan', date '2020-05-01') as gone_conf \gset
update public.plans set organiser_user_id = '00000000-0000-0000-0000-0000000003a3' where id = :'gone_plan';
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000003a3';
select pg_temp.act_as('00000000-0000-0000-0000-0000000003a3');
select throws_ok(
  format($$select public.report_outcome('%s', 'happened')$$, :'gone_conf'),
  'P0001',
  'not_the_organiser',
  'an organiser who has left the circle cannot report its outcome — the state machine''s guard, with its code, not a copy of it'
);

-- ---------------------------------------------------------------------------
-- Removal, continued: not coming to anything still ahead; history untouched.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
update public.circle_members set status = 'active'
where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000003a3';
update public.attendance set status = 'going'
where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a3';
select was_there_before from (
  select status as was_there_before from public.attendance
  where confirmation_id = :'past_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'
) s \gset

update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000003a3';
select is(
  (select status from public.attendance
   where confirmation_id = :'future_conf' and user_id = '00000000-0000-0000-0000-0000000003a3'),
  'cant',
  'a removed member is not coming to a live confirmation'
);
-- An evening that has ended but not yet been reported on: still `active`, but
-- not ahead.
select pg_temp.make_confirmed_plan('pncfuu', date '2020-04-01') as unreported_plan \gset
select pg_temp.confirm(:'unreported_plan', date '2020-04-01') as unreported_conf \gset
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000003a2';
select is(
  (select status from public.attendance
   where confirmation_id = :'past_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'),
  :'was_there_before',
  'but what they said about a meetup that already happened stays as it was (spec §4.5)'
);
select is(
  (select status from public.attendance
   where confirmation_id = :'unreported_conf' and user_id = '00000000-0000-0000-0000-0000000003a2'),
  'going',
  'and so does a "going" to an evening that has ended but nobody has reported on yet'
);

-- ---------------------------------------------------------------------------
-- Shapes that must be refused.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select throws_ok(
  format($$update public.meetup_confirmations set place_url = 'javascript:alert(1)' where id = '%s'$$,
    :'future_conf'),
  '23514',
  null,
  'a place link is http(s) or nothing'
);
select throws_ok(
  format($$update public.meetup_confirmations set note = repeat('x', 281) where id = '%s'$$,
    :'future_conf'),
  '23514',
  null,
  'a note is at most 280 characters'
);
select throws_ok(
  format($$update public.meetup_confirmations set superseded_at = now() where id = '%s'$$,
    :'future_conf'),
  '23514',
  null,
  'an active confirmation cannot carry a superseded_at'
);
select throws_ok(
  format($$update public.meetup_confirmations set chased_answer = 'lots' where id = '%s'$$, :'future_conf'),
  '23514',
  null,
  'the chasing answer is none, one or more'
);
select ok(
  not has_table_privilege('authenticated', 'public.outcome_reports', 'insert'),
  'outcome_reports has no client insert privilege at all'
);

select * from finish();
rollback;
