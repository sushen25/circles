-- The organiser changes their own answer (SUS-158).
--
-- `replace_response` treats the organiser as it treats any member: they are a
-- participant of the plan they made, so a second answer replaces the first, the
-- plan's input moves so the options are recalculated, and it is refused when the
-- plan is no longer taking answers. These pin that, because the organiser's
-- screens now offer the action.

begin;
select plan(7);

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

-- Maya organises, Priya and Tom are asked too.
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000002a3', 'Tom');

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-orgchange');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-orgchange';
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
  1050, 1350, 120, 3, timestamptz '2099-09-20T10:00:00Z', 'pnmrgc'
from t;
create temporary table tp as select id as plan_id from public.plans where short_code = 'pnmrgc';
grant select on tp to anon, authenticated, service_role;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, u from tp, unnest(array[
  '00000000-0000-0000-0000-0000000002a1'::uuid,
  '00000000-0000-0000-0000-0000000002a2'::uuid,
  '00000000-0000-0000-0000-0000000002a3'::uuid
]) as u;

-- 18:30–20:30 Melbourne on the 17th, then 19:00–21:00 on the 18th, as instants.
create or replace function pg_temp.win(day text, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::date::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

-- The organiser is a participant like any member, so a second answer is the
-- same replacement a member's is (SUS-158).
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select lives_ok(
  format($$select public.replace_response('%s', 1, 'windows', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-17', 1110, 1230)),
  'the organiser answers their own plan'
);

select pg_temp.act_as_postgres();
create temporary table before_version as
select input_version from public.plans where id = (select plan_id from tp);
grant select on before_version to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select lives_ok(
  format($$select public.replace_response('%s', 1, 'windows', jsonb_build_array(%L::jsonb))$$,
    (select plan_id from tp), pg_temp.win('2099-09-18', 1140, 1260)),
  'and answers again, with other times'
);
select is(
  (select count(*)::integer from public.plan_responses
    where plan_id = (select plan_id from tp) and user_id = '00000000-0000-0000-0000-0000000002a1'),
  1,
  'which replaces the first answer rather than adding to it'
);
select is(
  (select count(*)::integer from public.willing_windows ww
    join public.plan_responses r on r.id = ww.response_id
    where r.plan_id = (select plan_id from tp) and r.user_id = '00000000-0000-0000-0000-0000000002a1'
      and ww.starts_at = (pg_temp.win('2099-09-18', 1140, 1260) ->> 'start')::timestamptz),
  1,
  'with the new times and none of the old'
);
select is(
  (select count(*)::integer from public.willing_windows ww
    join public.plan_responses r on r.id = ww.response_id
    where r.plan_id = (select plan_id from tp) and r.user_id = '00000000-0000-0000-0000-0000000002a1'),
  1,
  'one window in all'
);
select pg_temp.act_as_postgres();
select cmp_ok(
  (select input_version from public.plans where id = (select plan_id from tp)),
  '>', (select input_version from before_version),
  'and the plan is marked for a recalculation, so the options move with it'
);

-- Locked in: the organiser is refused like anybody else.
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'confirmed' where id = (select plan_id from tp);
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select throws_ok(
  format($$select public.replace_response('%s', 1, 'flexible')$$, (select plan_id from tp)),
  'replies_closed',
  'once the plan is locked in the organiser cannot change their answer, as a member cannot'
);

select * from finish();
rollback;
