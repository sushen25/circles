-- What the others have said, for the person answering (SUS-129, ADR 00XX).
--
-- `public.others_availability` is the one way past `plan_responses_select_own`
-- and `willing_windows_select_own`, so the assertions that matter are about
-- what it does not hand back: an identifier, the caller's own answer, an
-- answer to an older question, a link between one person's days, and anything
-- at all to somebody who is not an active member.

begin;
select plan(35);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    case when anonymous then null else id::text || '@example.com' end, anonymous,
    jsonb_build_object('is_anonymous', anonymous),
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
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- An instant, as the function writes one: `{"start": …, "end": …}` on a day,
-- from minutes to minutes, in Melbourne.
create or replace function pg_temp.win(day text, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::date::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

-- Maya owns the circle; Priya, Tom and Jess are members; Sam is a guest (an
-- anonymous session); Gone will be removed; Nobody is in no circle at all.
select pg_temp.make_user('00000000-0000-0000-0000-0000000026a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000026a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000026a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000026a4', 'Jess');
select pg_temp.make_user('00000000-0000-0000-0000-0000000026a5', 'Sam', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000026a6', 'Gone');
select pg_temp.make_user('00000000-0000-0000-0000-0000000026a7', 'Nobody');

select pg_temp.act_as('00000000-0000-0000-0000-0000000026a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-others');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-others';
grant select on t to anon, authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t, (values
  ('00000000-0000-0000-0000-0000000026a2'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-0000000026a3'::uuid, 'Tom'),
  ('00000000-0000-0000-0000-0000000026a4'::uuid, 'Jess'),
  ('00000000-0000-0000-0000-0000000026a5'::uuid, 'Sam'),
  ('00000000-0000-0000-0000-0000000026a6'::uuid, 'Gone')
) as u (id, name);

-- Thursday 17 to Sunday 20 September 2099, 5:30–10:30 pm Melbourne, asking
-- all six. In 2099 so the deadline is ahead whenever this runs.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000026a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 3, timestamptz '2099-09-20T10:00:00Z', 'pnwhat'
from t;
create temporary table tp as select id as plan_id from public.plans where short_code = 'pnwhat';
grant select on tp to anon, authenticated;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, u from tp, unnest(array[
  '00000000-0000-0000-0000-0000000026a1'::uuid, '00000000-0000-0000-0000-0000000026a2'::uuid,
  '00000000-0000-0000-0000-0000000026a3'::uuid, '00000000-0000-0000-0000-0000000026a4'::uuid,
  '00000000-0000-0000-0000-0000000026a5'::uuid, '00000000-0000-0000-0000-0000000026a6'::uuid
]) as u;

-- What the function says to somebody, read as them.
create or replace function pg_temp.seen_by(id uuid, anonymous boolean default false)
returns jsonb language plpgsql as $$
declare
  result jsonb;
begin
  perform pg_temp.act_as(id, anonymous);
  result := public.others_availability((select plan_id from tp));
  perform pg_temp.act_as_postgres();
  return result;
end;
$$;

create or replace function pg_temp.answer(id uuid, status text, windows jsonb default '[]'::jsonb)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(id);
  perform public.replace_response((select plan_id from tp), 1, status, windows);
  perform pg_temp.act_as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------------

select has_function('public', 'others_availability', array['uuid'], 'others_availability exists');
select ok(
  has_function_privilege('authenticated', 'public.others_availability(uuid)', 'execute'),
  'a signed-in session may call it — guests are anonymous sessions, and members too'
);
select ok(
  not has_function_privilege('anon', 'public.others_availability(uuid)', 'execute'),
  'no session at all may not'
);
select pg_temp.act_as_anon();
select throws_ok(
  format($$select public.others_availability('%s')$$, (select plan_id from tp)),
  '42501',
  null,
  'and is refused when it tries'
);
select pg_temp.act_as_postgres();

select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a7'),
  null,
  'somebody in another circle gets nothing'
);
select is(
  public.others_availability(gen_random_uuid()),
  null,
  'nor does a plan that does not exist, and the two cannot be told apart'
);

-- ---------------------------------------------------------------------------
-- Nobody yet, and answers that are not times.
-- ---------------------------------------------------------------------------

select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2'),
  jsonb_build_object('asked', 6, 'answered', 0, 'with_times', 0, 'flexible', 0,
    'reader_answered', false, 'days', '[]'::jsonb),
  'before anybody answers: six asked, nobody in, nothing to count'
);

select pg_temp.answer('00000000-0000-0000-0000-0000000026a1', 'flexible');
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') - 'days',
  jsonb_build_object('asked', 6, 'answered', 1, 'with_times', 0, 'flexible', 1,
    'reader_answered', false),
  '"I''m easy" is an answer, and counted as flexible'
);
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') -> 'days',
  '[]'::jsonb,
  'but alone it does not meet the threshold'
);

select pg_temp.answer('00000000-0000-0000-0000-0000000026a3', 'none_work');
select is(
  (pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') ->> 'answered')::integer,
  2,
  '"none of these dates" counts as answered'
);
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') -> 'days',
  '[]'::jsonb,
  'and adds no time, so there is still nothing to count'
);

-- ---------------------------------------------------------------------------
-- One answer with times: the threshold, which is one (the founder's decision).
-- ---------------------------------------------------------------------------

-- Jess: Thursday 6:30–8:30 pm and Saturday 7–9 pm, and Saturday 9:30–10:30.
select pg_temp.answer('00000000-0000-0000-0000-0000000026a4', 'windows', jsonb_build_array(
  pg_temp.win('2099-09-17', 1110, 1230),
  pg_temp.win('2099-09-19', 1140, 1260),
  pg_temp.win('2099-09-19', 1290, 1350)));

select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') - 'days',
  jsonb_build_object('asked', 6, 'answered', 3, 'with_times', 1, 'flexible', 1,
    'reader_answered', false),
  'one other answer with times meets the threshold'
);
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') -> 'days',
  jsonb_build_array(
    jsonb_build_array(pg_temp.win('2099-09-17', 1110, 1230)),
    jsonb_build_array(pg_temp.win('2099-09-19', 1140, 1260), pg_temp.win('2099-09-19', 1290, 1350))),
  'and with exactly one, the days are that person''s answer, one entry per day'
);

-- ---------------------------------------------------------------------------
-- The caller's own answer never counts.
-- ---------------------------------------------------------------------------

select pg_temp.answer('00000000-0000-0000-0000-0000000026a2', 'windows', jsonb_build_array(
  pg_temp.win('2099-09-17', 1050, 1140)));

select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') - 'days',
  jsonb_build_object('asked', 6, 'answered', 3, 'with_times', 1, 'flexible', 1,
    'reader_answered', true),
  'Priya, having answered, is not among the others she reads about'
);
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') -> 'days',
  jsonb_build_array(
    jsonb_build_array(pg_temp.win('2099-09-17', 1110, 1230)),
    jsonb_build_array(pg_temp.win('2099-09-19', 1140, 1260), pg_temp.win('2099-09-19', 1290, 1350))),
  'and her own windows are not in what she reads'
);
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a4') -> 'days',
  jsonb_build_array(jsonb_build_array(pg_temp.win('2099-09-17', 1050, 1140))),
  'while Jess reads Priya''s and not her own'
);

-- ---------------------------------------------------------------------------
-- A guest, and the shape of what comes back.
-- ---------------------------------------------------------------------------

-- Sam, a guest: Thursday 8–10 pm and Sunday 5:30–6:30.
select pg_temp.answer('00000000-0000-0000-0000-0000000026a5', 'windows', jsonb_build_array(
  pg_temp.win('2099-09-17', 1200, 1320),
  pg_temp.win('2099-09-20', 1050, 1110)));

select isnt(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a5', true),
  null,
  'a guest who is a member reads it too'
);

create temporary table seen as
select pg_temp.seen_by('00000000-0000-0000-0000-0000000026a6') as r;
grant select on seen to authenticated;

select is(
  (select array_agg(k order by k) from seen, jsonb_object_keys(r) as k),
  array['answered', 'asked', 'days', 'flexible', 'reader_answered', 'with_times'],
  'the result is numbers, a yes or no, and the days: nothing else'
);
select is(
  (select count(*)::integer from seen, jsonb_array_elements(r -> 'days') as e,
     jsonb_array_elements(e) as w
   where (select array_agg(k order by k) from jsonb_object_keys(w) as k) <> array['end', 'start']),
  0,
  'and every window in it is a start and an end, with nothing beside them'
);
select ok(
  not exists (
    select 1 from seen, auth.users u
    where u.id::text like '00000000-0000-0000-0000-0000000026a%'
      and (position(u.id::text in r::text) > 0
        or position(lower(u.raw_user_meta_data ->> 'display_name') in lower(r::text)) > 0)
  ),
  'no user id and no name appears anywhere in it'
);
select ok(
  not exists (
    select 1 from seen, public.plan_responses pr, public.willing_windows w
    where w.response_id = pr.id and pr.plan_id = (select plan_id from tp)
      and (position(pr.id::text in r::text) > 0 or position(w.id::text in r::text) > 0)
  ),
  'nor any response or window id'
);
select is(
  (select count(*)::integer from seen, jsonb_array_elements(r -> 'days') as e
   where (select count(distinct ((w ->> 'start')::timestamptz at time zone 'Australia/Melbourne')::date)
          from jsonb_array_elements(e) as w) <> 1),
  0,
  'each entry is one day: nothing joins a person''s Thursday to their Saturday'
);
select is(
  (select jsonb_array_length(r -> 'days') from seen),
  5,
  'five entries: one for each day each of three people gave times on'
);
select is(
  (select jsonb_agg(e order by ordinality) from seen, jsonb_array_elements(r -> 'days')
     with ordinality as x (e, ordinality)),
  (select jsonb_agg(e order by (e -> 0 ->> 'start')::timestamptz, (e -> -1 ->> 'end')::timestamptz)
     from seen, jsonb_array_elements(r -> 'days') as e),
  'and they come in the order of the times in them, never of who gave them'
);
select is(
  (select r -> 'days' -> 0 from seen),
  jsonb_build_array(pg_temp.win('2099-09-17', 1050, 1140)),
  'so Thursday''s earliest comes first, whoever it is'
);

-- ---------------------------------------------------------------------------
-- Only the current revision, and only active members.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-0000000026a6';
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a6'),
  null,
  'a removed member gets nothing'
);
select is(
  (pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') ->> 'asked')::integer,
  5,
  'and is no longer one of the people the plan asks'
);

-- Sam leaves; their answer is still on the row, and stops counting.
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-0000000026a5';
select is(
  (pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') ->> 'with_times')::integer,
  1,
  'an answer from somebody no longer a member is not counted'
);
select is(
  jsonb_array_length(pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') -> 'days'),
  2,
  'and their days are gone from what others read'
);
-- Back in the circle, but no longer asked: leaving took Sam off the plan's
-- audience (`on_member_removed`), and joining again does not opt back in.
update public.circle_members set status = 'active'
where user_id = '00000000-0000-0000-0000-0000000026a5';

-- The organiser changes the question. Every answer was to the old one.
select is(
  (select revision from planning.transition_plan((select plan_id from tp), 'edit',
    '00000000-0000-0000-0000-0000000026a1', '{"quorum": 2}'::jsonb)),
  2,
  'an edit asks a new question'
);
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2'),
  jsonb_build_object('asked', 4, 'answered', 0, 'with_times', 0, 'flexible', 0,
    'reader_answered', false, 'days', '[]'::jsonb),
  'and answers to the old one count for nothing: nobody has answered this one'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000026a4');
select public.replace_response((select plan_id from tp), 2, 'windows',
  jsonb_build_array(pg_temp.win('2099-09-18', 1110, 1230)));
select pg_temp.act_as_postgres();
select is(
  pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') -> 'days',
  jsonb_build_array(jsonb_build_array(pg_temp.win('2099-09-18', 1110, 1230))),
  'an answer to the new question counts, and only it'
);
select is(
  (pg_temp.seen_by('00000000-0000-0000-0000-0000000026a2') ->> 'reader_answered')::boolean,
  false,
  'and Priya''s answer to the old question is not an answer to this one'
);

-- ---------------------------------------------------------------------------
-- Nothing else changed: the tables are still the owner's alone.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000026a2');
select is(
  (select count(*)::integer from public.plan_responses where user_id <> '00000000-0000-0000-0000-0000000026a2'),
  0,
  'Priya still cannot select anybody else''s response'
);
select is(
  (select count(*)::integer from public.willing_windows w
   join public.plan_responses r on r.id = w.response_id
   where r.user_id <> '00000000-0000-0000-0000-0000000026a2'),
  0,
  'nor anybody else''s window'
);
select pg_temp.act_as_postgres();

select * from finish();
rollback;
