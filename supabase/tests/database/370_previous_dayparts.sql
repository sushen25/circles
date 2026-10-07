-- "Use my previous times": the day-parts the caller has offered before, in the
-- parts this plan asks about (SUS-159, ADR 0037's amendment).
--
-- `public.previous_dayparts` is a definer function over the caller's own rows,
-- so the cases that matter are about whose rows it reads and what it hands
-- back: text and never a window, nobody else's answer, nothing from another
-- circle, nothing for a non-member, and each window classed in the zone of the
-- plan it was given to.

begin;
select plan(35);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', false, jsonb_build_object('is_anonymous', false),
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
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Maya owns circle A, Priya and Tom are members; Gone will be removed; Nobody
-- is in no circle; Priya is also a member of circle B, owned by Maya.
select pg_temp.make_user('00000000-0000-0000-0000-0000000037a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000037a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000037a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000037a4', 'Gone');
select pg_temp.make_user('00000000-0000-0000-0000-0000000037a5', 'Nobody');

select pg_temp.act_as('00000000-0000-0000-0000-0000000037a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-prev-a');
select public.create_circle('Work Crew', 'sky', 'Australia/Melbourne', 'key-prev-b');
select pg_temp.act_as_postgres();

create temporary table t as
  select (select id from public.circles where creation_key = 'key-prev-a') as a,
         (select id from public.circles where creation_key = 'key-prev-b') as b;
grant select on t to anon, authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select a, u.id, u.name from t, (values
  ('00000000-0000-0000-0000-0000000037a2'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-0000000037a3'::uuid, 'Tom'),
  ('00000000-0000-0000-0000-0000000037a4'::uuid, 'Gone')
) as u (id, name);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select b, '00000000-0000-0000-0000-0000000037a2', 'Priya' from t;

create or replace function pg_temp.mkplan(circle uuid, title text, zone text, first_day date,
  last_day date, from_min integer, to_min integer, code text)
returns uuid language sql as $$
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  ) values (
    circle, 'named', 'collecting', '00000000-0000-0000-0000-0000000037a1', title, zone,
    first_day, last_day, from_min, to_min, 60, 2, (first_day::timestamp + interval '1 hour') at time zone zone, code
  ) returning id;
$$;

-- Thursday 17 to Sunday 20 September 2099 (Thu, Fri, Sat, Sun). `ev` asks
-- 5:30-10:30 pm: weekday and weekend evenings and nothing else. `wide` asks
-- all day. `daytime` asks 9-noon, Monday to Wednesday. `gap` is Friday 18 to
-- Monday 21 with only those two listed: two weekdays, with a weekend between.
-- `perth` is in Perth. `old1`..`old4` are earlier Thursdays to Sundays in
-- August, in circle A; `other` is in circle B.
select pg_temp.mkplan(a, 'Evenings', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20', 1050, 1350, 'pdevng') from t;
select pg_temp.mkplan(a, 'Wide', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20', 0, 1440, 'pdwade') from t;
select pg_temp.mkplan(a, 'Daytime', 'Australia/Melbourne', date '2099-09-21', date '2099-09-23', 540, 720, 'pdday2') from t;
select pg_temp.mkplan(a, 'Gap', 'Australia/Melbourne', date '2099-09-18', date '2099-09-21', 0, 1440, 'pdgap2') from t;
select pg_temp.mkplan(a, 'Perth', 'Australia/Perth', date '2099-09-17', date '2099-09-20', 0, 1440, 'pdperth') from t;
select pg_temp.mkplan(a, 'Earlier one', 'Australia/Melbourne', date '2099-08-06', date '2099-08-09', 0, 1440, 'pdsad2') from t;
select pg_temp.mkplan(a, 'Earlier two', 'Australia/Melbourne', date '2099-08-13', date '2099-08-16', 0, 1440, 'pdsad3') from t;
select pg_temp.mkplan(a, 'Earlier three', 'Australia/Melbourne', date '2099-08-20', date '2099-08-23', 0, 1440, 'pdsad4') from t;
select pg_temp.mkplan(a, 'Earlier four', 'Australia/Melbourne', date '2099-08-27', date '2099-08-30', 0, 1440, 'pdsad5') from t;
select pg_temp.mkplan(b, 'Elsewhere', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20', 0, 1440, 'pdesse') from t;
insert into public.plan_days (plan_id, day)
select id, d from public.plans, unnest(array[date '2099-09-18', date '2099-09-21']) d
where short_code = 'pdgap2';

create temporary table tp as select short_code, id from public.plans;
grant select on tp to anon, authenticated;
create or replace function pg_temp.pid(code text) returns uuid language sql as $$
  select id from tp where short_code = code;
$$;

-- An answer, as a row, the way `replace_response` leaves one. Windows are
-- `[day, from_minute, to_minute]` in the plan's own zone.
create or replace function pg_temp.reply(who uuid, code text, revision integer, status text,
  windows jsonb default '[]'::jsonb)
returns void language plpgsql as $$
declare
  rid uuid;
  zone text;
  w jsonb;
begin
  select time_zone into zone from public.plans where short_code = code;
  insert into public.plan_responses (plan_id, revision, user_id, status)
  values (pg_temp.pid(code), revision, who, status) returning id into rid;
  for w in select * from jsonb_array_elements(windows) loop
    insert into public.willing_windows (response_id, starts_at, ends_at)
    values (rid,
      ((w ->> 0)::date::timestamp + make_interval(mins => (w ->> 1)::integer)) at time zone zone,
      ((w ->> 0)::date::timestamp + make_interval(mins => (w ->> 2)::integer)) at time zone zone);
  end loop;
end;
$$;

-- What the function says to somebody, read as them.
create or replace function pg_temp.prev(who uuid, code text) returns text[] language plpgsql as $$
declare
  result text[];
begin
  perform pg_temp.act_as(who);
  result := public.previous_dayparts(pg_temp.pid(code));
  perform pg_temp.act_as_postgres();
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------------

select has_function('public', 'previous_dayparts', array['uuid'], 'previous_dayparts exists');
select ok(
  has_function_privilege('authenticated', 'public.previous_dayparts(uuid)', 'execute'),
  'a signed-in session may call it'
);
select ok(
  not has_function_privilege('anon', 'public.previous_dayparts(uuid)', 'execute'),
  'no session at all may not'
);
select pg_temp.act_as_anon();
select throws_ok(
  format($$select public.previous_dayparts('%s')$$, pg_temp.pid('pdwade')),
  '42501', null, 'and is refused when it tries'
);
select pg_temp.act_as_postgres();
select is(pg_typeof(public.previous_dayparts(pg_temp.pid('pdwade')))::text, 'text[]',
  'it answers with text, a list of day-part names, and nothing else');

select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a5', 'pdwade'), array[]::text[],
  'somebody in no circle gets nothing');
select pg_temp.act_as('00000000-0000-0000-0000-0000000037a2');
select is(public.previous_dayparts(gen_random_uuid()), array[]::text[],
  'nor does a plan that does not exist, and the two cannot be told apart');
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- No history, and history that is not times.
-- ---------------------------------------------------------------------------

select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade'), array[]::text[],
  'nobody who has not answered anything is offered anything');

select pg_temp.reply('00000000-0000-0000-0000-0000000037a3', 'pdsad2', 1, 'flexible');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdwade'), array[]::text[],
  'a history of "I''m easy" only offers nothing');

-- ---------------------------------------------------------------------------
-- One earlier answer is enough.
-- ---------------------------------------------------------------------------

-- Priya, Thursday 6-8 pm on the second plan.
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdsad3', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-08-13', 1080, 1200)));
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade'),
  array['weekday_evening'], 'one earlier answer with times is enough');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdevng'),
  array['weekday_evening'], 'and the same on a plan that asks about evenings only');

-- ---------------------------------------------------------------------------
-- Several: the union, and a part offered once counts.
-- ---------------------------------------------------------------------------

-- First plan: Saturday 9-11 am, once; and Thursday 6-8 pm again.
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdsad2', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-08-08', 540, 660), jsonb_build_array('2099-08-06', 1080, 1200)));
-- Third plan: Saturday 1-3 pm, then edited to "I'm easy": the latest revision counts.
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdsad4', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-08-22', 780, 900)));
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdsad4', 2, 'flexible');
-- Fourth plan: Saturday 7-9 pm, then edited to Thursday 6-8 pm.
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdsad5', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-08-29', 1140, 1260)));
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdsad5', 2, 'windows',
  jsonb_build_array(jsonb_build_array('2099-08-27', 1080, 1200)));

select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade'),
  array['weekday_evening', 'weekend_morning'],
  'every part offered, in order: a Saturday morning offered once among three weekday evenings is there');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdevng'),
  array['weekday_evening'],
  'a part this plan does not ask about is not returned');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdday2'), array[]::text[],
  'a plan that asks about weekday mornings only gets nothing when none was ever offered');
select ok(
  not (pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade') && array['weekend_afternoon', 'weekend_evening']),
  'only the latest revision counts: an afternoon and an evening given and then withdrawn are gone');

-- The plan's own answer is not an earlier one.
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdwade', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-09-19', 1140, 1260), jsonb_build_array('2099-09-20', 840, 960)));
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade'),
  array['weekday_evening', 'weekend_morning'],
  'the plan''s own answer is not counted');

-- ---------------------------------------------------------------------------
-- A window covers every part it spans.
-- ---------------------------------------------------------------------------

-- Tom, Thursday 9 am to 10:30 pm on the second plan.
select pg_temp.reply('00000000-0000-0000-0000-0000000037a3', 'pdsad3', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-08-13', 540, 1350)));
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdwade'),
  array['weekday_morning', 'weekday_afternoon', 'weekday_evening'],
  'a window across the day offers the morning, the afternoon and the evening');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdday2'), array['weekday_morning'],
  'and a plan that asks 9 to noon gets the morning alone');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdevng'), array['weekday_evening'],
  'and one that asks evenings gets the evening alone');

-- ---------------------------------------------------------------------------
-- Whose windows, and which circle's.
-- ---------------------------------------------------------------------------

select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade'),
  array['weekday_evening', 'weekend_morning'],
  'Tom''s windows are never Priya''s: her answer did not change when his arrived');

-- Priya, in circle B, Sunday 8-10 pm.
select pg_temp.reply('00000000-0000-0000-0000-0000000037a2', 'pdesse', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-09-20', 1200, 1320)));
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade'),
  array['weekday_evening', 'weekend_morning'],
  'what she offered in another circle is not counted in this one');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdesse'), array[]::text[],
  'and in that circle, with only the plan''s own answer there, she is offered nothing');

-- ---------------------------------------------------------------------------
-- The stored counts: what retention has already deleted.
-- ---------------------------------------------------------------------------

insert into public.member_dayparts (circle_id, user_id, summary)
select a, '00000000-0000-0000-0000-0000000037a4',
  '{"parts": ["weekend_afternoon"], "counts": {"weekend_afternoon": 2, "weekday_morning": 0}}'::jsonb
from t;
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a4', 'pdwade'), array['weekend_afternoon'],
  'a stored summary with no retained answers offers the parts it holds');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a4', 'pdevng'), array[]::text[],
  'limited to the parts this plan asks about');

insert into public.member_dayparts (circle_id, user_id, summary)
select a, '00000000-0000-0000-0000-0000000037a3',
  '{"parts": ["weekend_evening"], "counts": {"weekend_evening": 1}}'::jsonb
from t;
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdwade'),
  array['weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend_evening'],
  'the stored counts and the retained answers are added: nothing offered is forgotten');

insert into public.member_dayparts (circle_id, user_id, summary)
select b, '00000000-0000-0000-0000-0000000037a2',
  '{"parts": ["weekday_morning"], "counts": {"weekday_morning": 5}}'::jsonb
from t;
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a2', 'pdwade'),
  array['weekday_evening', 'weekend_morning'],
  'another circle''s stored summary is not counted either');

-- ---------------------------------------------------------------------------
-- A member who has gone.
-- ---------------------------------------------------------------------------

update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-0000000037a4';
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a4', 'pdwade'), array[]::text[],
  'a removed member is offered nothing');

-- ---------------------------------------------------------------------------
-- Each window in its own plan's zone, and the days the plan asks about.
-- ---------------------------------------------------------------------------

-- Maya, in Perth: Saturday 10-11 am (a weekend morning there; 12-1 pm in
-- Melbourne) and Sunday 10-11 pm (a weekend evening there; Monday midnight to
-- 1 am in Melbourne, a weekday morning).
select pg_temp.reply('00000000-0000-0000-0000-0000000037a1', 'pdperth', 1, 'windows',
  jsonb_build_array(jsonb_build_array('2099-09-19', 600, 660), jsonb_build_array('2099-09-20', 1320, 1380)));
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a1', 'pdwade'),
  array['weekend_morning', 'weekend_evening'],
  'a window is classed in its own plan''s zone, not the plan being answered');
select ok(
  not (pg_temp.prev('00000000-0000-0000-0000-0000000037a1', 'pdwade') && array['weekday_morning', 'weekend_afternoon']),
  'and the parts it would have fallen in, in this plan''s zone, are not there');

select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdgap2'),
  array['weekday_morning', 'weekday_afternoon', 'weekday_evening'],
  'a plan with gaps asks only its listed days: a weekend between two weekdays is not asked');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a1', 'pdgap2'), array[]::text[],
  'and weekend parts offered are not returned for it');

-- A plan whose only weekend day is a Sunday, and a session in a zone whose
-- clocks change at midnight: neither moves a day or a part.
select pg_temp.mkplan((select a from t), 'Sunday', 'Australia/Melbourne', date '2099-09-20', date '2099-09-20', 0, 1440, 'pdsund');
select pg_temp.mkplan((select a from t), 'Sat to Mon', 'Australia/Melbourne', date '2099-09-05', date '2099-09-07', 0, 1440, 'pdtzne');
insert into tp select short_code, id from public.plans where short_code in ('pdsund', 'pdtzne');
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdsund'), array['weekend_evening'],
  'a Sunday is a weekend day: the stored weekend evening is offered for a Sunday-only plan');
set local timezone = 'America/Santiago';
select is(pg_temp.prev('00000000-0000-0000-0000-0000000037a3', 'pdtzne'),
  array['weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend_evening'],
  'the session''s time zone (clocks change at midnight there) does not drop the plan''s last day');
reset timezone;

-- ---------------------------------------------------------------------------
-- The tables are still the owner's alone.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000037a2');
select is(
  (select count(*)::integer from public.plan_responses where user_id <> '00000000-0000-0000-0000-0000000037a2'),
  0, 'Priya still cannot select anybody else''s response');
select is(
  (select count(*)::integer from public.willing_windows w
   join public.plan_responses r on r.id = w.response_id
   where r.user_id <> '00000000-0000-0000-0000-0000000037a2'),
  0, 'nor anybody else''s window');
select pg_temp.act_as_postgres();

select * from finish();
rollback;
