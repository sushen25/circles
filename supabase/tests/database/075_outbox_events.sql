-- The debt paid: every writer that has owed the outbox an event since S1-07
-- now writes it, in the same transaction, and says nothing it must not.
--
-- The privacy assertions matter more than the counts. A quiet ask's events
-- carry no user id at all; a threshold event carries the plan and the keen
-- count only (§6.3, §14).

begin;
select plan(33);

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

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.win(day text, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::date::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

-- Events since a mark, as (name, payload). Read as the owner: the outbox is
-- nobody else's to read.
create or replace function pg_temp.events_since(mark bigint)
returns table (event_name text, aggregate_type text, aggregate_id uuid, payload jsonb)
language sql security definer as $$
  select o.event_name, o.aggregate_type, o.aggregate_id, o.payload
  from jobs.outbox o where o.seq > mark order by o.seq;
$$;
create or replace function pg_temp.mark() returns bigint language sql security definer as $$
  select coalesce(max(seq), 0) from jobs.outbox;
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000005a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000005a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000005a3', 'Tom');

-- ---------------------------------------------------------------------------
-- create_circle: two events, no name.
-- ---------------------------------------------------------------------------

select pg_temp.mark() as m0 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-events');
select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where name = 'Sunday Crew';
grant select on t to anon, authenticated, service_role;

select is(
  (select array_agg(event_name order by event_name) from pg_temp.events_since(:'m0')),
  array['circles.circle_created', 'circles.member_joined'],
  'creating a circle leaves exactly two events'
);
select is(
  (select payload ->> 'owner_user_id' from pg_temp.events_since(:'m0') where event_name = 'circles.circle_created'),
  '00000000-0000-0000-0000-0000000005a1',
  'circle_created names the owner by id'
);
select ok(
  not exists (select 1 from pg_temp.events_since(:'m0') where payload ? 'name'),
  'and never the circle''s name'
);
select is(
  (select payload ->> 'role' from pg_temp.events_since(:'m0') where event_name = 'circles.member_joined'),
  'owner',
  'member_joined says the first member is the owner'
);

-- Idempotent replay creates nothing, so announces nothing.
select pg_temp.mark() as m1 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-events');
select pg_temp.act_as_postgres();
select is((select count(*)::integer from pg_temp.events_since(:'m1')), 0, 'a replayed create_circle emits nothing');

-- Joining and removal, from whichever writer.
select pg_temp.mark() as m2 \gset
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u, n from t, (values
  ('00000000-0000-0000-0000-0000000005a2'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-0000000005a3'::uuid, 'Tom')
) as v (u, n);
select is(
  (select array_agg(payload ->> 'user_id' order by payload ->> 'user_id') from pg_temp.events_since(:'m2')),
  array['00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005a3'],
  'every membership insert announces member_joined, not only create_circle''s'
);

-- ---------------------------------------------------------------------------
-- The transition table is total under event_for.
-- ---------------------------------------------------------------------------

select is(
  (select coalesce(string_agg(from_state || '/' || action, ', '), '')
   from planning.transitions
   where planning.event_for(from_state, action) is null),
  '',
  'every transition in planning.transitions has an outbox event name'
);
select is(planning.event_for('confirmed', 'cancel'), 'confirmation.meetup_cancelled',
  'cancelling a confirmed meetup is a meetup_cancelled, not a plan_cancelled');
select is(planning.event_for('ready', 'confirm'), 'confirmation.meetup_confirmed', 'confirm → meetup_confirmed');

-- ---------------------------------------------------------------------------
-- A quiet ask says nothing about who.
-- ---------------------------------------------------------------------------

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code, quiet_threshold
)
select circle_id, 'quiet', 'draft', null,
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-18T10:00:00Z', 'pnevqq', 2
from t;
select id as quiet from public.plans where short_code = 'pnevqq' \gset
insert into private.plan_initiators (plan_id, initiator_user_id) values (:'quiet', '00000000-0000-0000-0000-0000000005a2');

select pg_temp.mark() as m3 \gset
select planning.transition_plan(:'quiet', 'create_quiet', '00000000-0000-0000-0000-0000000005a2');
select is(
  (select event_name from pg_temp.events_since(:'m3')),
  'planning.quiet_ask_created',
  'create_quiet announces quiet_ask_created'
);
select ok(
  not exists (
    select 1 from pg_temp.events_since(:'m3'), jsonb_each_text(payload) as kv
    where kv.value = '00000000-0000-0000-0000-0000000005a2'
  ),
  'and the initiator''s id appears nowhere in the payload'
);
select is(
  (select array_agg(k order by k) from pg_temp.events_since(:'m3'), jsonb_object_keys(payload) as k),
  array['action', 'circle_id', 'from_state', 'mode', 'plan_id', 'revision', 'to_state'],
  'the payload is the plan, the transition and nothing about people'
);

insert into private.plan_interest (plan_id, user_id, response) values
  (:'quiet', '00000000-0000-0000-0000-0000000005a2', 'keen'),
  (:'quiet', '00000000-0000-0000-0000-0000000005a3', 'keen');
select pg_temp.mark() as m4 \gset
select planning.transition_plan(:'quiet', 'threshold_reached', '00000000-0000-0000-0000-0000000005a3');
select is(
  (select payload -> 'keen_count' from pg_temp.events_since(:'m4')),
  '2'::jsonb,
  'threshold_reached carries the keen count'
);
select ok(
  not exists (select 1 from pg_temp.events_since(:'m4') where payload::text like '%0000000005a%'),
  'and no user id of any kind'
);

select pg_temp.mark() as m5 \gset
select planning.transition_plan(:'quiet', 'accept_organiser', '00000000-0000-0000-0000-0000000005a1');
select is(
  (select payload ->> 'organiser_user_id' from pg_temp.events_since(:'m5') where event_name = 'planning.organiser_accepted'),
  '00000000-0000-0000-0000-0000000005a1',
  'organiser_accepted names the organiser — a public fact from here on'
);

-- ---------------------------------------------------------------------------
-- Answers.
-- ---------------------------------------------------------------------------

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000005a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-18T10:00:00Z', 'pnevnn'
from t;
select id as named from public.plans where short_code = 'pnevnn' \gset
insert into public.plan_participants (plan_id, revision, user_id)
select :'named', 1, u from unnest(array[
  '00000000-0000-0000-0000-0000000005a1'::uuid,
  '00000000-0000-0000-0000-0000000005a2'::uuid,
  '00000000-0000-0000-0000-0000000005a3'::uuid
]) as u;

select pg_temp.mark() as m6 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a2');
select public.replace_response(:'named', 1, 'windows', jsonb_build_array(pg_temp.win('2099-09-17', 1050, 1170)));
select pg_temp.act_as_postgres();
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m6')),
  array['availability.response_submitted'],
  'an answer with a window is one response_submitted — not one per window, not one per bump'
);
select is(
  (select payload ->> 'status' from pg_temp.events_since(:'m6')),
  'windows',
  'carrying the status'
);
select ok(
  not exists (select 1 from pg_temp.events_since(:'m6') where payload ? 'windows' or payload ? 'start'),
  'and not the windows themselves'
);

select pg_temp.mark() as m7 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a2');
select public.replace_response(:'named', 1, 'not_this_time');
select pg_temp.act_as_postgres();
select is(
  (select payload ->> 'status' from pg_temp.events_since(:'m7')),
  'not_this_time',
  'changing the answer is another response_submitted'
);

-- Removal: the answer is cleared, and the membership is gone, in one statement.
select pg_temp.mark() as m8 \gset
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000005a2';
select is(
  (select array_agg(event_name order by event_name) from pg_temp.events_since(:'m8')),
  array['availability.response_cleared', 'circles.member_removed'],
  'removing a member announces the removal and the cleared answer'
);

-- ---------------------------------------------------------------------------
-- Confirming: the plan, the confirmation, the attendance and the event, in
-- one call.
-- ---------------------------------------------------------------------------

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000005a1',
  'Catch up', 'Australia/Melbourne', date '2099-11-01', date '2099-11-04',
  1050, 1350, 120, 2, timestamptz '2099-11-02T10:00:00Z', 'pnevrd'
from t;
select id as ready from public.plans where short_code = 'pnevrd' \gset
insert into public.plan_participants (plan_id, revision, user_id)
values (:'ready', 1, '00000000-0000-0000-0000-0000000005a1'), (:'ready', 1, '00000000-0000-0000-0000-0000000005a3');
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a3');
select public.replace_response(:'ready', 1, 'not_this_time');
select pg_temp.act_as_postgres();
select planning.transition_plan(:'ready', 'candidates_ready', '00000000-0000-0000-0000-0000000005a1');
insert into public.candidate_sets (plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count)
select :'ready', 1, p.input_version, p.scoring_version, 'h', 10, 1, 1, 2 from public.plans p where p.id = :'ready'
returning id as cset \gset
insert into public.candidates (candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count)
values (:'cset', false, 1, timestamptz '2099-11-01T07:30:00Z', timestamptz '2099-11-01T09:30:00Z',
  array['00000000-0000-0000-0000-0000000005a1']::uuid[], 1, 0, 'best_attendance', 1);

select pg_temp.mark() as m14 \gset
select planning.transition_plan(:'ready', 'confirm', '00000000-0000-0000-0000-0000000005a1',
  '{"candidate_id": "2099-11-01T07:30:00Z", "place_name": "Hope St Radio", "note": "Bring a jumper"}'::jsonb);
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m14')),
  array['confirmation.meetup_confirmed'],
  'confirming announces meetup_confirmed, and only that'
);
select ok(
  not exists (select 1 from pg_temp.events_since(:'m14') where payload ? 'note' or payload ? 'place_name'),
  'without the note or the place'
);
select is(
  (select (status, note, place_name, confirmed_by::text, cardinality(available_user_ids))
   from public.meetup_confirmations where plan_id = :'ready' and revision = 1),
  ('active'::text, 'Bring a jumper'::text, 'Hope St Radio'::text, '00000000-0000-0000-0000-0000000005a1'::text, 1),
  'the confirmation row exists in the same call, frozen from the candidate, with the details'
);
select is(
  (select array_agg(a.status order by a.user_id) from public.attendance a
   join public.meetup_confirmations c on c.id = a.confirmation_id where c.plan_id = :'ready'),
  array['going', 'cant'],
  'and attendance is derived: Maya available → going, Tom answered and not available → cant'
);
select throws_ok(
  format($$select planning.transition_plan('%s', 'confirm', '00000000-0000-0000-0000-0000000005a1',
    '{"candidate_id": "2099-11-01T07:30:00Z", "attendee_email": "x"}'::jsonb)$$, :'ready'),
  'P0001',
  null,
  'a key confirm does not take is refused'
);

-- The backstop: confirmed with nothing confirmed cannot commit.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'confirmed', '00000000-0000-0000-0000-0000000005a1',
  'Catch up', 'Australia/Melbourne', date '2099-12-01', date '2099-12-04',
  1050, 1350, 120, 2, timestamptz '2099-12-02T10:00:00Z', 'pnevbb'
from t;
select throws_ok(
  'set constraints all immediate',
  '23514',
  'confirmed_without_confirmation',
  'a plan cannot reach commit as confirmed without an active confirmation for its revision'
);

-- ---------------------------------------------------------------------------
-- Attendance.
-- ---------------------------------------------------------------------------

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'confirmed', '00000000-0000-0000-0000-0000000005a1',
  'Catch up', 'Australia/Melbourne', date '2099-10-01', date '2099-10-04',
  1050, 1350, 120, 2, timestamptz '2099-10-02T10:00:00Z', 'pnevcc'
from t;
select id as confirmed from public.plans where short_code = 'pnevcc' \gset
insert into public.plan_participants (plan_id, revision, user_id)
values (:'confirmed', 1, '00000000-0000-0000-0000-0000000005a1'), (:'confirmed', 1, '00000000-0000-0000-0000-0000000005a3');
insert into public.meetup_confirmations
  (plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by)
values (:'confirmed', 1, '2099-10-01T18:30', timestamptz '2099-10-01T07:30:00Z', timestamptz '2099-10-01T09:30:00Z',
  array['00000000-0000-0000-0000-0000000005a1']::uuid[], '00000000-0000-0000-0000-0000000005a1')
returning id as conf \gset

select pg_temp.mark() as m9 \gset
insert into public.attendance (confirmation_id, user_id, status) values
  (:'conf', '00000000-0000-0000-0000-0000000005a1', 'going');
select is((select count(*)::integer from pg_temp.events_since(:'m9')), 0,
  'the derived rows written at confirmation are not "updates" anybody made');

-- Tom has no derived row: his first answer is an insert, and it is his.
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a3');
insert into public.attendance (confirmation_id, user_id, status)
values (:'conf', '00000000-0000-0000-0000-0000000005a3', 'going');
select pg_temp.act_as_postgres();
select is(
  (select payload ->> 'status' from pg_temp.events_since(:'m9') where event_name = 'confirmation.attendance_updated'),
  'going',
  'Tom saying he is coming, as his first word on it, is an attendance_updated'
);
select pg_temp.mark() as m10 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a3');
update public.attendance set status = 'going'
where confirmation_id = :'conf' and user_id = '00000000-0000-0000-0000-0000000005a3';
select pg_temp.act_as_postgres();
select is((select count(*)::integer from pg_temp.events_since(:'m10')), 0,
  'saying it again is not');

-- Nudges: the client writes the row, the row announces itself.
select pg_temp.mark() as m12 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a3');
insert into public.nudge_states (user_id, moment, plan_id)
values ('00000000-0000-0000-0000-0000000005a3', 'confirmed', :'confirmed');
select pg_temp.act_as_postgres();
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m12')),
  array['growth.nudge_shown'],
  'a prompt shown is a nudge_shown'
);
select pg_temp.mark() as m13 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a3');
update public.nudge_states set answer = 'dismissed'
where user_id = '00000000-0000-0000-0000-0000000005a3' and moment = 'confirmed';
select pg_temp.act_as_postgres();
select is(
  (select payload ->> 'answer' from pg_temp.events_since(:'m13') where event_name = 'growth.nudge_answered'),
  'dismissed',
  'and what was done with it is a nudge_answered'
);

-- Leaving `confirmed`.
select pg_temp.mark() as m11 \gset
select planning.transition_plan(:'confirmed', 'cancel', '00000000-0000-0000-0000-0000000005a1', '{"cancel_note": "Rain"}');
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m11')),
  array['confirmation.meetup_cancelled'],
  'cancelling a confirmed meetup announces meetup_cancelled'
);
select ok(
  not exists (select 1 from pg_temp.events_since(:'m11') where payload ? 'cancel_note'),
  'without the note'
);

select * from finish();
rollback;
