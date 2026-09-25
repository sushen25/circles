-- Guest → saved place (S2-07): the prompts' record and the one fact the
-- after-attendance prompt needs from the database.
--
-- Sunday Crew: Maya owns it, Priya is a guest member, Sam is somebody else's
-- friend with an account and no place in it. Two meetups: 5 March, which
-- happened on Maya's word, and 17 September, which Priya says she was at.

begin;
select plan(24);

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

create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text,
    true);
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

select pg_temp.make_user('25000000-0000-0000-0000-0000000000a1', 'Maya');
select pg_temp.make_user('25000000-0000-0000-0000-0000000000a2', 'Priya', false);
select pg_temp.make_user('25000000-0000-0000-0000-0000000000a3', 'Sam');

select pg_temp.act_as('25000000-0000-0000-0000-0000000000a1');
create temporary table t as
select id as circle_id from public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-growth');
select pg_temp.act_as_postgres();
grant select on t to authenticated, anon;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '25000000-0000-0000-0000-0000000000a2'::uuid, 'Priya' from t;

-- A confirmed meetup, in the past, that Maya organised and both were asked to.
create or replace function pg_temp.meetup(code text, day date, plan_state text) returns uuid
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
  select circle_id, 'named', plan_state, '25000000-0000-0000-0000-0000000000a1',
    'Catch up', 'Australia/Melbourne', day, day + 3, 1050, 1350, 120, 2,
    (day::timestamp + interval '1 day') at time zone 'Australia/Melbourne', code
  from t returning id into new_plan;

  insert into public.plan_participants (plan_id, revision, user_id)
  select new_plan, 1, u from unnest(array[
    '25000000-0000-0000-0000-0000000000a1'::uuid,
    '25000000-0000-0000-0000-0000000000a2'::uuid
  ]) as u;

  insert into public.meetup_confirmations (
    plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by,
    status, confirmed_at
  ) values (
    new_plan, 1, (day::timestamp + interval '18 hours 30 minutes')::text,
    (day::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
    (day::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
    array['25000000-0000-0000-0000-0000000000a2'::uuid], '25000000-0000-0000-0000-0000000000a1',
    'active', (day::timestamp) at time zone 'Australia/Melbourne'
  ) returning id into new_conf;

  return new_plan;
end;
$$;

select pg_temp.meetup('pngrwa', date '2026-09-17', 'confirmed') as thursday \gset
create temporary table ids as select :'thursday'::uuid as thursday;
grant select on ids to authenticated, anon;

-- ---------------------------------------------------------------------------
-- after_attendance_facts: the first meetup, and "I was there".
-- ---------------------------------------------------------------------------

select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select array[attended, first_in_circle] from public.after_attendance_facts(:'thursday')),
  array[false, true],
  'before Priya answers, it is the circle''s first meetup and she has not said she was there'
);

select pg_temp.act_as_postgres();
insert into public.attendance (confirmation_id, user_id, status)
select c.id, '25000000-0000-0000-0000-0000000000a2', 'was_there'
from public.meetup_confirmations c where c.plan_id = :'thursday';

select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select array[attended, first_in_circle] from public.after_attendance_facts(:'thursday')),
  array[true, true],
  'after "I was there", this is the moment for "Start a circle"'
);

select pg_temp.act_as('25000000-0000-0000-0000-0000000000a3');
select is_empty(
  $$ select * from public.after_attendance_facts((select thursday from ids)) $$,
  'Sam, who is not in the circle, learns nothing about its meetups: no row at all'
);

select pg_temp.act_as_anon();
select throws_ok(
  $$ select * from public.after_attendance_facts((select thursday from ids)) $$,
  '42501',
  null,
  'and nobody signed out may ask'
);

-- An earlier meetup of the circle that happened, on the organiser's word.
select pg_temp.act_as_postgres();
select pg_temp.meetup('pngrwb', date '2026-03-05', 'confirmed') as march \gset
insert into public.outcome_reports (confirmation_id, reported_by, outcome, reported_at)
select c.id, '25000000-0000-0000-0000-0000000000a1', 'happened', timestamptz '2026-03-06T09:00:00Z'
from public.meetup_confirmations c where c.plan_id = :'march';

select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select array[attended, first_in_circle] from public.after_attendance_facts(:'thursday')),
  array[true, false],
  'once another meetup of the circle happened, Thursday is not its first'
);

-- The same earlier meetup, reported `not_sure` by the organiser, but Priya said
-- she was there: her own word counts for her.
select pg_temp.act_as_postgres();
-- As though Maya had said `not_sure`: the report is not `happened`, and the
-- circle's "last caught up" is not moved by it.
update public.outcome_reports set outcome = 'not_sure'
where confirmation_id = (select id from public.meetup_confirmations where plan_id = :'march');
update public.circles set last_met_at = null where id = (select circle_id from t);
select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select first_in_circle from public.after_attendance_facts(:'thursday')),
  true,
  'an earlier meetup nobody says happened does not count'
);
select pg_temp.act_as_postgres();
insert into public.attendance (confirmation_id, user_id, status)
select c.id, '25000000-0000-0000-0000-0000000000a2', 'was_there'
from public.meetup_confirmations c where c.plan_id = :'march';
select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select first_in_circle from public.after_attendance_facts(:'thursday')),
  false,
  'but one Priya herself says she was at does'
);

-- "Last caught up" alone is not a meetup: only a `happened` report moves it,
-- and the report is what is counted, so the answer is the same whether or not
-- the organiser has reported Thursday yet (review round 2).
select pg_temp.act_as_postgres();
delete from public.attendance
where confirmation_id = (select id from public.meetup_confirmations where plan_id = :'march');
update public.circles set last_met_at = timestamptz '2026-08-08T08:30:00Z'
where id = (select circle_id from t);
select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select first_in_circle from public.after_attendance_facts(:'thursday')),
  true,
  'before Maya reports Thursday, it is the first'
);
select pg_temp.act_as_postgres();
insert into public.outcome_reports (confirmation_id, reported_by, outcome)
select c.id, '25000000-0000-0000-0000-0000000000a1', 'happened'
from public.meetup_confirmations c where c.plan_id = :'thursday';
select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select array[attended, first_in_circle] from public.after_attendance_facts(:'thursday')),
  array[true, true],
  'and after, still: reporting this meetup does not change whether it was the first'
);
select pg_temp.act_as_postgres();
update public.outcome_reports set outcome = 'cancelled'
where confirmation_id = (select id from public.meetup_confirmations where plan_id = :'thursday');
select pg_temp.act_as('25000000-0000-0000-0000-0000000000a2', true);
select is(
  (select attended from public.after_attendance_facts(:'thursday')),
  false,
  'an evening the organiser says was called off is not the moment, whatever Priya said'
);

-- ---------------------------------------------------------------------------
-- nudge_states: the moments, and which of them name a plan.
-- ---------------------------------------------------------------------------

select lives_ok(
  format($$insert into public.nudge_states (user_id, moment, plan_id)
    values ('25000000-0000-0000-0000-0000000000a2', 'after_attendance_start_circle', '%s')$$,
    :'thursday'),
  'Priya records the after-attendance prompt against the plan it followed'
);
select lives_ok(
  format($$insert into public.nudge_states (user_id, moment, plan_id)
    values ('25000000-0000-0000-0000-0000000000a2', 'reattached_save_place', '%s')$$,
    :'thursday'),
  'and "save your place" after a reattach against the plan she came back through'
);
select throws_ok(
  $$insert into public.nudge_states (user_id, moment)
    values ('25000000-0000-0000-0000-0000000000a2', 'reattached_save_place')$$,
  '23514',
  null,
  'which it must name: that is how it travels with her next reattach'
);
select lives_ok(
  $$insert into public.nudge_states (user_id, moment)
    values ('25000000-0000-0000-0000-0000000000a2', 'organiser_gate')$$,
  'the organiser gate is about no plan'
);
select throws_ok(
  format($$insert into public.nudge_states (user_id, moment, plan_id)
    values ('25000000-0000-0000-0000-0000000000a2', 'organiser_gate', '%s')$$, :'thursday'),
  '23514',
  null,
  'and cannot be given one'
);
select throws_ok(
  $$insert into public.nudge_states (user_id, moment)
    values ('25000000-0000-0000-0000-0000000000a2', 'organiser_gate')$$,
  '23505',
  null,
  'so it is one row per person, answered again rather than added to'
);
select throws_ok(
  format($$insert into public.nudge_states (user_id, moment, plan_id)
    values ('25000000-0000-0000-0000-0000000000a2', 'confirmed', '%s')$$, :'thursday'),
  '23514',
  null,
  'a moment from before 0028 is not a moment any more'
);

-- When the answer was given: stamped, and kept through anything but a new answer.
select is(
  (select answered_at from public.nudge_states where moment = 'reattached_save_place' and plan_id = :'thursday'),
  null,
  'a prompt shown and not answered has no answer time'
);
update public.nudge_states set answer = 'dismissed' where moment = 'reattached_save_place' and plan_id = :'thursday';
select isnt(
  (select answered_at from public.nudge_states where moment = 'reattached_save_place' and plan_id = :'thursday'),
  null,
  '"not now" stamps when it was said, which is what the 30-day back-off counts from'
);
select pg_temp.act_as_postgres();
-- Backdated past the trigger, which would otherwise keep the time it stamped.
alter table public.nudge_states disable trigger nudge_states_stamp_answer;
update public.nudge_states set answered_at = timestamptz '2026-09-01T00:00:00Z'
where moment = 'reattached_save_place' and plan_id = :'thursday';
alter table public.nudge_states enable trigger nudge_states_stamp_answer;
update public.nudge_states set user_id = '25000000-0000-0000-0000-0000000000a3'
where moment = 'reattached_save_place' and plan_id = :'thursday';
select is(
  (select answered_at from public.nudge_states where moment = 'reattached_save_place' and plan_id = :'thursday'),
  timestamptz '2026-09-01T00:00:00Z',
  'and a reattach moving the row to a new identity does not restart the clock'
);

select pg_temp.act_as('25000000-0000-0000-0000-0000000000a3');
select throws_ok(
  format($$insert into public.nudge_states (user_id, moment, plan_id)
    values ('25000000-0000-0000-0000-0000000000a3', 'sent_save_access', '%s')$$, :'thursday'),
  '42501',
  null,
  'nobody records a prompt about a plan in a circle they are not in'
);

-- ---------------------------------------------------------------------------
-- claim_identity: the two new places a place is saved from.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select lives_ok(
  $$ select * from public.claim_identity('25000000-0000-0000-0000-0000000000a3',
                                         '25000000-0000-0000-0000-0000000000a3', 'organiser_gate') $$,
  'a place saved at the organiser gate is claimed at that moment'
);
select is(
  (select o.payload ->> 'moment' from jobs.outbox o
   where o.event_name = 'growth.account_claimed'
     and o.aggregate_id = '25000000-0000-0000-0000-0000000000a3'),
  'organiser_gate',
  'and the funnel is told which'
);
select lives_ok(
  $$ select * from public.claim_identity('25000000-0000-0000-0000-0000000000a1',
                                         '25000000-0000-0000-0000-0000000000a1', 'reattached') $$,
  'as is one saved after a Continue-as'
);

select * from finish();
rollback;
