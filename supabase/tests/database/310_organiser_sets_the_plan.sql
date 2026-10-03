-- The organiser sets the final plan (SUS-138, ADR 0051).
--
-- An own time is accepted from `collecting` and `ready` and from nobody but the
-- organiser; a time in the past, off the half hour or too far ahead is refused in
-- the database; it records that it was the organiser's own and whether it was
-- below the plan's number, and leaves the number alone; who is going follows the
-- rules (going for the people it covers, everyone else to confirm, never "can't
-- make it"); a move leaves exactly one active confirmation and derives again,
-- nothing carries over; a place or note edit changes nobody and says nothing; and
-- an answer arriving afterwards changes nothing.

begin;
select plan(61);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', false, '{"is_anonymous": false}'::jsonb,
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', false)::text,
    true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- A window on a day of the plan, in Melbourne minutes.
create or replace function pg_temp.win(day text, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::date::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

create or replace function pg_temp.at(day text, from_min integer)
returns timestamptz language sql as $$
  select (day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne';
$$;

create or replace function pg_temp.events_since(mark bigint)
returns table (event_name text, payload jsonb)
language sql security definer as $$
  select o.event_name, o.payload from jobs.outbox o where o.seq > mark order by o.seq;
$$;
create or replace function pg_temp.mark() returns bigint language sql security definer as $$
  select coalesce(max(seq), 0) from jobs.outbox;
$$;

-- Maya organises. Priya, Tom, Jess, Sam and Alex are asked.
select pg_temp.make_user('00000000-0000-0000-0000-0000000031a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000031a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000031a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000031a4', 'Jess');
select pg_temp.make_user('00000000-0000-0000-0000-0000000031a5', 'Sam');
select pg_temp.make_user('00000000-0000-0000-0000-0000000031a6', 'Alex');
select pg_temp.make_user('00000000-0000-0000-0000-0000000031a9', 'Stranger');

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-own-time');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-own-time';
grant select on t to authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t, (values
  ('00000000-0000-0000-0000-0000000031a2'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-0000000031a3'::uuid, 'Tom'),
  ('00000000-0000-0000-0000-0000000031a4'::uuid, 'Jess'),
  ('00000000-0000-0000-0000-0000000031a5'::uuid, 'Sam'),
  ('00000000-0000-0000-0000-0000000031a6'::uuid, 'Alex')
) as u (id, name);

-- In 2099, so every time is ahead whenever this runs. Quorum four, the 17th to
-- the 20th, 5:30-10:30 pm.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000031a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 4, timestamptz '2099-09-16T10:00:00Z', 'pnwxtm'
from t;
create temporary table tp as select id as plan_id from public.plans where short_code = 'pnwxtm';
grant select on tp to authenticated;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, u from tp, unnest(array[
  '00000000-0000-0000-0000-0000000031a1'::uuid, '00000000-0000-0000-0000-0000000031a2'::uuid,
  '00000000-0000-0000-0000-0000000031a3'::uuid, '00000000-0000-0000-0000-0000000031a4'::uuid,
  '00000000-0000-0000-0000-0000000031a5'::uuid, '00000000-0000-0000-0000-0000000031a6'::uuid
]) as u;

-- Thursday 6:30-8:30 pm suits Maya, Priya and Tom; Saturday 7-9 pm suits Maya
-- and Tom; Jess is easy; Sam cannot this time; Alex has not answered.
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select public.replace_response((select plan_id from tp), 1, 'windows',
  jsonb_build_array(pg_temp.win('2099-09-17', 1110, 1230), pg_temp.win('2099-09-19', 1140, 1260)));
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a2');
select public.replace_response((select plan_id from tp), 1, 'windows',
  jsonb_build_array(pg_temp.win('2099-09-17', 1110, 1230)));
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a3');
select public.replace_response((select plan_id from tp), 1, 'windows',
  jsonb_build_array(pg_temp.win('2099-09-17', 1110, 1230), pg_temp.win('2099-09-19', 1140, 1260)));
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a4');
select public.replace_response((select plan_id from tp), 1, 'flexible');
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a5');
select public.replace_response((select plan_id from tp), 1, 'not_this_time');

-- ---------------------------------------------------------------------------
-- Who a stretch works for: the organiser alone, by id, in the engine's order.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
create temporary table thursday as
  select public.stretch_availability(
    (select plan_id from tp), pg_temp.at('2099-09-17', 1140), pg_temp.at('2099-09-17', 1200)
  ) as r;
grant select on thursday to authenticated;

select is(
  (select r -> 'available' from thursday),
  jsonb_build_array(
    '00000000-0000-0000-0000-0000000031a1', '00000000-0000-0000-0000-0000000031a2',
    '00000000-0000-0000-0000-0000000031a3', '00000000-0000-0000-0000-0000000031a4'),
  'Thursday 7-8 pm works for Maya, Priya, Tom, and Jess, who is easy'
);
select is(
  (select r -> 'cannot' from thursday),
  jsonb_build_array('00000000-0000-0000-0000-0000000031a5'),
  'it does not work for Sam, who answered otherwise'
);
select is(
  (select r -> 'awaiting' from thursday),
  jsonb_build_array('00000000-0000-0000-0000-0000000031a6'),
  'and Alex has not answered, which is not "does not work"'
);
select ok(
  (select (r ? 'input_version') and (r ? 'revision') and not (r ? 'windows') from thursday),
  'it carries the version the confirmation will compare, and no windows'
);
select is(
  (select r -> 'available' from (select public.stretch_availability(
    (select plan_id from tp), pg_temp.at('2099-09-17', 1140), pg_temp.at('2099-09-17', 1260)) as r) x),
  jsonb_build_array('00000000-0000-0000-0000-0000000031a4'),
  'a window has to contain the whole stretch: only the easy answer covers 7-9 pm'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a2');
select throws_ok(
  format('select public.stretch_availability(%L, now(), now() + interval ''1 hour'')', (select plan_id from tp)),
  'P0001', 'not_the_organiser', 'a member is not shown who it works for by name'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a9');
select throws_ok(
  format('select public.stretch_availability(%L, now(), now() + interval ''1 hour'')', (select plan_id from tp)),
  'P0001', 'plan_not_found', 'a stranger is told the plan is not there'
);

-- ---------------------------------------------------------------------------
-- Refusals, in the database as well as on the screen.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select (r ->> 'input_version')::integer as v from thursday \gset

select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1260), :v - 1),
  'P0001', 'stale_availability',
  'an answer that arrived while the organiser was looking is noticed before anything is frozen'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, null, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1260)),
  'P0001', 'stale_availability', 'and so is a request that names no version'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, null)', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1260), :v),
  'P0001', 'chased_answer_required', 'the survey question is still required'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    timestamptz '2020-09-18T09:00:00Z', timestamptz '2020-09-18T11:00:00Z', :v),
  'P0001', 'own_time_in_the_past', 'a time in the past is refused'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140) + interval '10 minutes', pg_temp.at('2099-09-18', 1260),
    :v),
  'P0001', 'own_time_off_the_half_hour', 'a time off the half hour is refused'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1140 + 360), :v),
  'P0001', 'own_time_too_long', 'longer than five hours is refused'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1140 + 15), :v),
  'P0001', 'own_time_off_the_half_hour', 'a quarter of an hour is off the half hour first'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1140 + 0), :v),
  'P0001', 'own_time_ends_before_it_starts', 'a stretch that ends where it starts is refused'
);
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-10-21', 1140), pg_temp.at('2099-10-21', 1260), :v),
  'P0001', 'own_time_too_far_ahead', 'a start after the last day plus thirty is refused'
);
select lives_ok(
  format('select public.stretch_availability(%L, %L, %L)', (select plan_id from tp),
    pg_temp.at('2099-10-20', 1380), pg_temp.at('2099-10-20', 1410)),
  'the picker may ask about the last allowed day'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a2');
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1260), :v),
  'P0001', 'not_the_organiser', 'a member may not set the final plan'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a9');
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1260), :v),
  'P0001', 'plan_not_found', 'nor may somebody outside the circle, who is told nothing'
);

-- ---------------------------------------------------------------------------
-- Friday 7-9 pm: not an option, and below the number. From `collecting`.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select pg_temp.mark() as m1 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
create temporary table own as
  select * from public.confirm_own_time((select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1260), :v, 'one',
    'Hope St Radio', null, 'Come if you can');
select pg_temp.act_as_postgres();
grant select on own to authenticated;

select is((select state from public.plans where id = (select plan_id from tp)), 'confirmed',
  'the plan is confirmed from collecting, with no option offered');
select is((select (own_time, below_quorum)::text from own), '(t,t)',
  'the confirmation records that it was the organiser''s own and below the number');
select is((select quorum from public.plans where id = (select plan_id from tp)), 4,
  'and the plan''s number is exactly what it was');
select is((select available_user_ids from own), array['00000000-0000-0000-0000-0000000031a4']::uuid[],
  'only Jess, who is easy, could make it, and that is what was frozen');
select is((select calendar_sequence from own), 0, 'its calendar entry begins at sequence zero');
select is(
  (select count(*)::integer from public.attendance a where a.confirmation_id = (select id from own)
    and a.status = 'going'),
  1, 'Jess is going');
select is(
  (select count(*)::integer from public.attendance a where a.confirmation_id = (select id from own)
    and a.status = 'unknown'),
  5, 'everybody else is to confirm, answered or not');
select is(
  (select count(*)::integer from public.attendance a where a.confirmation_id = (select id from own)
    and a.status = 'cant'),
  0, 'and nobody is marked "can''t make it" by an own time');
select is(
  (select a.status from public.attendance a where a.confirmation_id = (select id from own)
    and a.user_id = '00000000-0000-0000-0000-0000000031a1'),
  'unknown', 'the organiser follows their own answer, like anyone: Maya''s times did not cover Friday');
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m1')),
  array['confirmation.meetup_confirmed'], 'it is announced as locked in');
select is(
  (select payload ->> 'own_time' from pg_temp.events_since(:'m1')), 'true',
  'and the event says only that it was the organiser''s own time');

-- An answer arriving after lock-in changes nothing.
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a6');
select throws_ok(
  format('select public.replace_response(%L, 1, ''flexible'')', (select plan_id from tp)),
  '23514', 'replies_closed', 'an answer after lock-in is refused');
select pg_temp.act_as_postgres();
select is((select available_user_ids from public.meetup_confirmations where id = (select id from own)),
  array['00000000-0000-0000-0000-0000000031a4']::uuid[], 'and the frozen set is as it was');

-- ---------------------------------------------------------------------------
-- A move: Saturday 7-9 pm. Same revision, one active confirmation, derived again.
-- ---------------------------------------------------------------------------

-- Priya sets herself to going for Friday by hand; it must not carry over.
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a2');
update public.attendance set status = 'going'
where confirmation_id = (select id from own) and user_id = '00000000-0000-0000-0000-0000000031a2';

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select (public.stretch_availability((select plan_id from tp), pg_temp.at('2099-09-19', 1140),
  pg_temp.at('2099-09-19', 1260)) ->> 'input_version')::integer as v2 \gset

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a3');
select throws_ok(
  format('select public.edit_confirmation(%L, %L, %L, %s)', (select plan_id from tp),
    pg_temp.at('2099-09-19', 1140), pg_temp.at('2099-09-19', 1260), :v2),
  'P0001', 'not_the_organiser', 'a member may not move it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select throws_ok(
  format('select public.edit_confirmation(%L, %L, %L, %s)', (select plan_id from tp),
    pg_temp.at('2099-09-19', 1140), pg_temp.at('2099-09-19', 1260), :v2 - 1),
  'P0001', 'stale_availability', 'a move is held to the names the organiser saw');
select throws_ok(
  format('select public.edit_confirmation(%L, %L, %L, %s)', (select plan_id from tp),
    timestamptz '2020-09-19T09:00:00Z', timestamptz '2020-09-19T11:00:00Z', :v2),
  'P0001', 'own_time_in_the_past', 'and to a time that is ahead');
select throws_ok(
  format('select public.edit_confirmation(%L, %L, %L, %s, %L, null, %L)', (select plan_id from tp),
    null, null, :v2, 'Hope St Radio', 'Come if you can'),
  'P0001', 'nothing_to_change', 'a save that changes nothing is refused, so a repeat is not a second move');

select pg_temp.act_as_postgres();
select pg_temp.mark() as m2 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
create temporary table moved as
  select * from public.edit_confirmation((select plan_id from tp),
    pg_temp.at('2099-09-19', 1140), pg_temp.at('2099-09-19', 1260), :v2,
    'Hope St Radio', null, 'Come if you can');
select pg_temp.act_as_postgres();
grant select on moved to authenticated;

select is(
  (select count(*)::integer from public.meetup_confirmations
   where plan_id = (select plan_id from tp) and status = 'active'),
  1, 'a move leaves exactly one active confirmation');
select is(
  (select (status, superseded_reason)::text from public.meetup_confirmations where id = (select id from own)),
  '(superseded,move)', 'and Friday''s is superseded as moved, keeping the time it held');
select is(
  (select (p.revision, p.state)::text from public.plans p join moved m on m.plan_id = p.id and m.revision = p.revision),
  '(1,confirmed)', 'in the same revision, so nobody is asked again');
select is(
  (select (own_time, below_quorum, calendar_uid = (select calendar_uid from own), calendar_sequence,
    moved_from_starts_at = (select starts_at from own))::text from moved),
  '(t,t,t,1,t)', 'the move (still below the number, with three of six) says where it came from and keeps the calendar entry with a higher sequence');
select is(
  (select array_agg(a.user_id order by a.user_id) from public.attendance a
   where a.confirmation_id = (select id from moved) and a.status = 'going'),
  array['00000000-0000-0000-0000-0000000031a1', '00000000-0000-0000-0000-0000000031a3',
    '00000000-0000-0000-0000-0000000031a4']::uuid[],
  'Maya, Tom and Jess are going without doing anything');
select is(
  (select array_agg(a.user_id order by a.user_id) from public.attendance a
   where a.confirmation_id = (select id from moved) and a.status = 'unknown'),
  array['00000000-0000-0000-0000-0000000031a2', '00000000-0000-0000-0000-0000000031a5',
    '00000000-0000-0000-0000-0000000031a6']::uuid[],
  'Priya, Sam and Alex are to confirm, and what Priya set by hand for Friday did not carry over');
select is(
  (select count(*)::integer from public.attendance a where a.confirmation_id = (select id from moved)
   and a.status = 'cant'),
  0, 'nobody is "can''t make it" after a move either');
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m2')),
  array['confirmation.meetup_moved'], 'a move is announced once, as its own event');
select is(
  (select a.status from public.attendance a where a.confirmation_id = (select id from own)
   and a.user_id = '00000000-0000-0000-0000-0000000031a2'),
  'going', 'the old confirmation''s rows stay as history');

-- ---------------------------------------------------------------------------
-- A place and note edit: in place, nobody's status, no event.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select pg_temp.mark() as m3 \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
create temporary table edited as
  select * from public.edit_confirmation((select plan_id from tp), null, null, null,
    'Naked for Satan', 'https://example.com/naked', null);
select pg_temp.act_as_postgres();

select is((select (id = (select id from moved), place_name, place_url, note)::text from edited),
  format('(t,"Naked for Satan",https://example.com/naked,)'),
  'the place and note are updated in place on the same confirmation, and a null clears');
select is(
  (select count(*)::integer from public.meetup_confirmations where plan_id = (select plan_id from tp)),
  2, 'no new confirmation was written');
select is((select calendar_sequence from public.meetup_confirmations where id = (select id from moved)), 2,
  'but the calendar entry''s sequence rose, so a calendar takes the new place');
select is(
  (select count(*)::integer from public.attendance a where a.confirmation_id = (select id from moved)
   and a.status = 'going'),
  3, 'nobody''s status changed');
select is((select count(*)::integer from pg_temp.events_since(:'m3')), 0,
  'and nothing was announced, so nobody is emailed');

-- ---------------------------------------------------------------------------
-- The letters follow the move: what was queued for the old time is taken back.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
insert into jobs.notification_jobs
  (channel, kind, user_id, plan_id, plan_revision, confirmation_id, scheduled_for, idempotency_key)
select 'push', k.kind, '00000000-0000-0000-0000-0000000031a1', tp.plan_id, 1, k.confirmation,
  now() + interval '1 day', repeat(k.digit, 64)
from tp, (values
  ('reminder', 'a', (select id from moved)),
  ('moved', 'b', (select id from own)),
  ('did_it_happen', 'c', null::uuid)
) as k (kind, digit, confirmation);

-- A retried move event must not skip its own letters: the unique key would then
-- refuse to write them again. The ones for the confirmation it made are kept.
select is(public.dispatch_cancel_pending((select plan_id from tp), 1, (select id from moved)), 2,
  'a move takes back the letters of the confirmation it replaced, and of none');
select is(
  (select array_agg(kind order by kind) from jobs.notification_jobs
   where plan_id = (select plan_id from tp) and status = 'scheduled'),
  array['reminder'], 'and keeps the ones for the confirmation it made');
select is(public.dispatch_cancel_pending((select plan_id from tp), 1), 1,
  'a reopen or a cancellation keeps nothing');
select is(
  (select count(*)::integer from jobs.notification_jobs
   where plan_id = (select plan_id from tp) and status = 'skipped' and last_error = 'superseded'),
  3, 'as skipped, because nothing went wrong');

-- ---------------------------------------------------------------------------
-- Cancelled: refused. And an own time from `ready`.
-- ---------------------------------------------------------------------------

select planning.transition_plan((select plan_id from tp), 'cancel', '00000000-0000-0000-0000-0000000031a1');
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, %s, ''none'')', (select plan_id from tp),
    pg_temp.at('2099-09-18', 1140), pg_temp.at('2099-09-18', 1260), :v2),
  'P0001', 'plan_is_finished', 'a cancelled plan takes no own time');
select throws_ok(
  format('select public.edit_confirmation(%L, null, null, null, ''Elsewhere'')', (select plan_id from tp)),
  'P0001', 'plan_is_finished', 'and no edit');

select pg_temp.act_as_postgres();
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'ready', '00000000-0000-0000-0000-0000000031a1',
  'Catch up again', 'Australia/Melbourne', date '2099-09-27', date '2099-09-30',
  1050, 1350, 120, 2, timestamptz '2099-09-26T10:00:00Z', 'pnrdyk'
from t;
insert into public.plan_participants (plan_id, revision, user_id)
select p.id, 1, '00000000-0000-0000-0000-0000000031a1' from public.plans p where p.short_code = 'pnrdyk';

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select lives_ok(
  format('select public.confirm_own_time(%L, %L, %L, 1, ''none'')',
    (select id from public.plans where short_code = 'pnrdyk'),
    pg_temp.at('2099-09-28', 1140), pg_temp.at('2099-09-28', 1260)),
  'an own time is accepted from ready as well');
select pg_temp.act_as_postgres();
select is(
  (select (state, quorum)::text from public.plans where short_code = 'pnrdyk'),
  '(confirmed,2)', 'and it is confirmed');

-- ---------------------------------------------------------------------------
-- After a hand-off the new organiser has the same freedom: nothing here is tied
-- to who made the plan.
-- ---------------------------------------------------------------------------

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000031a1',
  'Handed on', 'Australia/Melbourne', date '2099-10-27', date '2099-10-30',
  1050, 1350, 120, 3, timestamptz '2099-10-26T10:00:00Z', 'pnhndk'
from t;
insert into public.plan_participants (plan_id, revision, user_id)
select p.id, 1, u from public.plans p,
  unnest(array['00000000-0000-0000-0000-0000000031a1'::uuid, '00000000-0000-0000-0000-0000000031a2'::uuid]) as u
where p.short_code = 'pnhndk';
select planning.transition_plan((select id from public.plans where short_code = 'pnhndk'), 'hand_off',
  '00000000-0000-0000-0000-0000000031a1',
  '{"organiser_user_id": "00000000-0000-0000-0000-0000000031a2"}'::jsonb);

select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
select throws_ok(
  format('select public.confirm_own_time(%L, %L, %L, 1, ''none'')',
    (select id from public.plans where short_code = 'pnhndk'),
    pg_temp.at('2099-10-28', 1140), pg_temp.at('2099-10-28', 1260)),
  'P0001', 'not_the_organiser', 'the organiser who handed it on no longer may');
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a2');
select lives_ok(
  format('select public.confirm_own_time(%L, %L, %L, 1, ''none'')',
    (select id from public.plans where short_code = 'pnhndk'),
    pg_temp.at('2099-10-28', 1140), pg_temp.at('2099-10-28', 1260)),
  'and the organiser it was handed to may lock in any time');
select pg_temp.act_as_postgres();
select is(
  (select state from public.plans where short_code = 'pnhndk'), 'confirmed',
  'and the plan is confirmed');

select * from finish();
rollback;
