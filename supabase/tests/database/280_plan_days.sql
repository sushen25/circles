-- A plan can ask about days with gaps between them (SUS-133, ADR 00ZZ).
--
-- `plan_days` holds the days only when there are gaps; no rows is every day of
-- the window, which is every preset and every plan stored before this. This
-- proves the shape (stored, read back, refused), who can read it, that the
-- availability check and the engine's input follow it, that a plan with no
-- rows behaves as it always did, and both branches of what changing the days
-- costs: taking away days nobody picked keeps every answer (`narrow`), and
-- taking away a day somebody picked — the editor's own answer included — or
-- adding one is a new question (`edit`).

begin;
select plan(40);

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

create or replace function pg_temp.win(day text, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::date::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

-- Maya organises; Priya answers; Kim is in another circle altogether.
select pg_temp.make_user('00000000-0000-0000-0000-0000000028a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000028a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000028a3', 'Kim');

-- One circle per plan, because a circle has one open plan at a time (ADR 0033).
create or replace function pg_temp.circle(key text) returns uuid language plpgsql as $$
declare
  made uuid;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000028a1');
  perform public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', key);
  perform pg_temp.act_as_postgres();
  select id into made from public.circles where creation_key = key;
  insert into public.circle_members (circle_id, user_id, display_name_snapshot)
  values (made, '00000000-0000-0000-0000-0000000028a2', 'Priya');
  return made;
end;
$$;

-- A plan from Thu 17 to Sun 27 September 2099, made by Maya, with the days given.
create or replace function pg_temp.make_plan(key text, days date[]) returns uuid
language plpgsql as $$
declare
  made public.plans;
begin
  perform pg_temp.circle(key);
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000028a1');
  select * into made from public.create_plan(
    (select id from public.circles where creation_key = key), 'Catch up', 'catch_up',
    coalesce(days[1], date '2099-09-17'), coalesce(days[cardinality(days)], date '2099-09-27'),
    1050, 1350, 120, 2, timestamptz '2099-09-16T10:00:00Z', null, days);
  perform pg_temp.act_as_postgres();
  return made.id;
end;
$$;

create or replace function pg_temp.days_of(id uuid) returns date[] language sql as $$
  select coalesce(array_agg(d.day order by d.day), array[]::date[])
  from public.plan_days d where d.plan_id = id;
$$;

create or replace function pg_temp.answer(plan_id uuid, who uuid, day text)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(who);
  perform public.replace_response(plan_id,
    (select revision from public.plans where id = plan_id), 'windows',
    jsonb_build_array(pg_temp.win(day, 1110, 1290)));
  perform pg_temp.act_as_postgres();
end;
$$;

create or replace function pg_temp.revise(plan_id uuid, payload jsonb, days date[])
returns jsonb language plpgsql as $$
declare
  result jsonb;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000028a1');
  result := public.revise_plan(plan_id, false, payload, null, null, days);
  perform pg_temp.act_as_postgres();
  return result;
end;
$$;

-- Thu 17 – Sun 20, Tue 22, Thu 24 – Sun 27: the ticket's own example.
create temporary table gappy as select pg_temp.make_plan('days-gappy', array[
  '2099-09-17', '2099-09-18', '2099-09-19', '2099-09-20', '2099-09-22',
  '2099-09-24', '2099-09-25', '2099-09-26', '2099-09-27'
]::date[]) as id;
grant select on gappy to authenticated;

-- ---------------------------------------------------------------------------
-- The shape.
-- ---------------------------------------------------------------------------

select is(pg_temp.days_of((select id from gappy)), array[
  '2099-09-17', '2099-09-18', '2099-09-19', '2099-09-20', '2099-09-22',
  '2099-09-24', '2099-09-25', '2099-09-26', '2099-09-27'
]::date[], 'a plan with gaps stores its days');
select is((select array[window_start, window_end] from public.plans where id = (select id from gappy)),
  array[date '2099-09-17', date '2099-09-27'], 'and its window is the first and last of them');

select is(pg_temp.days_of(pg_temp.make_plan('days-whole', array[
  '2099-09-17', '2099-09-18', '2099-09-19'
]::date[])), array[]::date[], 'a list that leaves no day out is stored as no rows: every day');
select is(pg_temp.days_of(pg_temp.make_plan('days-none', null)), array[]::date[],
  'and a preset, which sends no days, stores none');

select pg_temp.circle('days-bad');
select pg_temp.act_as('00000000-0000-0000-0000-0000000028a1');
create or replace function pg_temp.create_with(days date[], first date, last date)
returns void language sql as $$
  select from public.create_plan(
    (select id from public.circles where creation_key = 'days-bad'), 'Catch up', 'catch_up',
    first, last, 1050, 1350, 120, 2, timestamptz '2099-09-16T10:00:00Z', null, days);
$$;
select throws_ok(
  $$ select pg_temp.create_with(array['2099-09-17', '2099-09-30']::date[], '2099-09-17', '2099-09-27') $$,
  'P0001', 'days_invalid', 'a day outside the window is refused');
select throws_ok(
  $$ select pg_temp.create_with(array['2099-09-17', '2099-09-17', '2099-09-27']::date[], '2099-09-17', '2099-09-27') $$,
  'P0001', 'days_invalid', 'a repeated day is refused');
select throws_ok(
  $$ select pg_temp.create_with(array['2099-09-27', '2099-09-17']::date[], '2099-09-17', '2099-09-27') $$,
  'P0001', 'days_invalid', 'days out of order are refused');
select throws_ok(
  $$ select pg_temp.create_with(array['2099-09-18', '2099-09-27']::date[], '2099-09-17', '2099-09-27') $$,
  'P0001', 'days_invalid', 'days that do not start on the window''s first day are refused');
select pg_temp.act_as_postgres();

-- The table holds the same rule for anything that writes it, at commit.
create or replace function pg_temp.add_rows(id uuid, days date[]) returns void language plpgsql as $$
begin
  insert into public.plan_days select id, d from unnest(days) d;
  set constraints all immediate;
end;
$$;
create or replace function pg_temp.move_end(id uuid, last date) returns void language plpgsql as $$
begin
  update public.plans set window_end = last where plans.id = move_end.id;
  set constraints all immediate;
end;
$$;
select throws_ok(
  format($$ select pg_temp.add_rows(%L, array['2099-09-30']::date[]) $$, (select id from gappy)),
  '23514', null, 'a row past the window''s end is refused when the transaction checks it');
set constraints all deferred;
select throws_ok(
  format($$ select pg_temp.add_rows(%L, array['2099-09-21', '2099-09-23']::date[]) $$, (select id from gappy)),
  '23514', null, 'and so is filling in every gap: a window with none is written as no rows');
set constraints all deferred;
select throws_ok(
  format($$ select pg_temp.move_end(%L, '2099-09-28') $$, (select id from gappy)),
  '23514', null, 'a window moved away from its listed days is refused too');
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- Who reads it, and nobody writes it.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000028a2');
select is((select count(*)::integer from public.plan_days where plan_id = (select id from gappy)), 9,
  'a member of the circle reads the days');
select pg_temp.act_as('00000000-0000-0000-0000-0000000028a3');
select is((select count(*)::integer from public.plan_days where plan_id = (select id from gappy)), 0,
  'somebody outside it reads none');
select pg_temp.act_as('00000000-0000-0000-0000-0000000028a2');
select throws_ok(
  format($$ insert into public.plan_days values (%L, date '2099-09-21') $$, (select id from gappy)),
  '42501', null, 'and no client writes them');
select pg_temp.act_as_postgres();

select ok(not has_table_privilege('service_role', 'public.plan_days', 'insert'),
  'nor the service role: the days change through create_plan and revise_plan');

-- ---------------------------------------------------------------------------
-- Answers and the engine follow the days.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000028a2');
select throws_ok(
  format($$ select public.replace_response(%L, 1, 'windows', jsonb_build_array(%L::jsonb)) $$,
    (select id from gappy), pg_temp.win('2099-09-21', 1110, 1290)),
  '23514', 'outside_plan_window',
  'a window painted on a day the plan does not ask about is refused, by the name the editor knows');
select lives_ok(
  format($$ select public.replace_response(%L, 1, 'windows', jsonb_build_array(%L::jsonb)) $$,
    (select id from gappy), pg_temp.win('2099-09-22', 1110, 1290)),
  'one on a day it asks about is taken');
select pg_temp.act_as_postgres();

select is(jsonb_array_length(public.engine_input((select id from gappy)) -> 'plan' -> 'days'), 9,
  'the engine is given the days');
select is(public.dispatch_context((select id from gappy)) -> 'days' -> 4, '"2099-09-22"'::jsonb,
  'and so is the dispatcher, for the messages that name them');

-- An existing plan, with no rows: exactly as before.
create temporary table plain as select pg_temp.make_plan('days-plain', null) as id;
grant select on plain to authenticated;
select is(public.engine_input((select id from plain)) -> 'plan' -> 'days', 'null'::jsonb,
  'a plan with no rows gives the engine no days: every day');
select pg_temp.act_as('00000000-0000-0000-0000-0000000028a2');
select lives_ok(
  format($$ select public.replace_response(%L, 1, 'windows', jsonb_build_array(%L::jsonb)) $$,
    (select id from plain), pg_temp.win('2099-09-21', 1110, 1290)),
  'and takes a window on any day of its window, as it always did');
select pg_temp.act_as_postgres();
select is(pg_temp.revise((select id from plain), '{"quorum": 3}'::jsonb, null) ->> 'action', 'adjust',
  'a quorum change to it is still an adjustment');
select is(pg_temp.days_of((select id from plain)), array[]::date[], 'that writes no days');

-- ---------------------------------------------------------------------------
-- What changing the days costs (ADR 00ZZ). Priya picked Tue 22 on the gappy
-- plan above; nobody picked anything else.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000028a1');
select is(array(select public.picked_days((select id from gappy))), array[date '2099-09-22'],
  'the organiser sees which days somebody picked, and not who');
select pg_temp.act_as('00000000-0000-0000-0000-0000000028a2');
select throws_ok(format($$ select public.picked_days(%L) $$, (select id from gappy)),
  'P0001', 'not_the_organiser', 'nobody else does');
select pg_temp.act_as_postgres();

-- Taking away Thu 18, which nobody picked.
create temporary table narrowed as select pg_temp.revise((select id from gappy), '{}'::jsonb, array[
  '2099-09-17', '2099-09-19', '2099-09-20', '2099-09-22',
  '2099-09-24', '2099-09-25', '2099-09-26', '2099-09-27'
]::date[]) as result;
select is((select result ->> 'action' from narrowed), 'narrow',
  'taking away a day nobody picked is a narrowing');
select is((select revision from public.plans where id = (select id from gappy)), 1,
  'which keeps the revision');
select is((select count(*)::integer from public.plan_responses where plan_id = (select id from gappy) and revision = 1), 1,
  'and every answer');
select is(pg_temp.days_of((select id from gappy)), array[
  '2099-09-17', '2099-09-19', '2099-09-20', '2099-09-22',
  '2099-09-24', '2099-09-25', '2099-09-26', '2099-09-27'
]::date[], 'the days are the new ones');
select is((select o.payload ->> 'action' from jobs.outbox o
  where o.event_name = 'planning.plan_revised' and o.aggregate_id = (select id from gappy)
  order by o.seq desc limit 1), 'narrow',
  'and the event says narrow, which asks nobody again');

-- The last day, unpicked: the window's end moves, and it is still free.
select is(pg_temp.revise((select id from gappy), '{"window_end": "2099-09-26"}'::jsonb, array[
  '2099-09-17', '2099-09-19', '2099-09-20', '2099-09-22', '2099-09-24', '2099-09-25', '2099-09-26'
]::date[]) ->> 'action', 'narrow', 'taking away the last day, unpicked, is a narrowing too');
select is((select array[window_end::text, revision::text] from public.plans where id = (select id from gappy)),
  array['2099-09-26', '1'], 'the window ends a day sooner, on the same revision');

-- A day only the editor had picked: their answer is cleared like anybody's.
select pg_temp.answer((select id from gappy), '00000000-0000-0000-0000-0000000028a1', '2099-09-24');
select is(pg_temp.revise((select id from gappy), '{}'::jsonb, array[
  '2099-09-17', '2099-09-19', '2099-09-20', '2099-09-22', '2099-09-25', '2099-09-26'
]::date[]) ->> 'action', 'edit',
  'taking away a day only the editor''s own answer picked is a new question');
select is((select revision from public.plans where id = (select id from gappy)), 2,
  'and starts a new revision');

-- Adding a day is a new question, however many go with it.
select is(pg_temp.revise((select id from gappy), '{}'::jsonb, array[
  '2099-09-17', '2099-09-18', '2099-09-19', '2099-09-20', '2099-09-22', '2099-09-25', '2099-09-26'
]::date[]) ->> 'action', 'edit', 'adding a day is a new question');

-- Try a wider window: new ends, no days sent — every day, and the gaps go.
select is(pg_temp.revise((select id from gappy),
  '{"window_end": "2099-10-16"}'::jsonb, null) ->> 'action', 'edit',
  'widening the window is a new question');
select is(pg_temp.days_of((select id from gappy)), array[]::date[],
  'and asks about every day of it: the gaps are dropped');

-- Days that do not fit the window they come with.
select throws_ok(
  format($$ select pg_temp.revise(%L, '{}'::jsonb, array['2099-09-18', '2099-10-16']::date[]) $$,
    (select id from gappy)),
  'P0001', 'days_invalid', 'revise_plan refuses days that do not start on the window''s first day');
select throws_ok(
  format($$ select pg_temp.revise(%L, '{}'::jsonb, array['2099-10-16', '2099-09-17']::date[]) $$,
    (select id from gappy)),
  'P0001', 'days_invalid', 'or that are out of order');

-- The commit-time check on everything above.
select lives_ok($$ set constraints all immediate $$, 'and what was written agrees with the windows');

select * from finish();
rollback;
