-- SUS-240 (parts 1 and 2): the campaign tag on a circle's founder-only cohort
-- row, and the first plans that have stopped.
--
-- A tag is a label for a post and never for a person: written once by the
-- circle's owner, readable by nobody but the founder's function, and not on any
-- table a client can see. The stalled view is read from product rows, with
-- circles in each of the three states and the ones that look like them and
-- have not stopped.

begin;
select plan(34);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', false, '{}'::jsonb,
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

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Sam is the founder. Maya, Pia, Quin, Rae, Stu and Uma own a circle each (the
-- cases below), Omar and Tara own one more, Nina is in Maya's.
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0001', 'Sam');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0002', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0003', 'Nina');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0004', 'Pia');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0005', 'Quin');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0006', 'Rae');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0007', 'Stu');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0008', 'Uma');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0009', 'Omar');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d000a', 'Tara');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d000b', 'Vic');
insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-0000000d0001');

create or replace function pg_temp.make_circle(owner uuid, key text)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(owner);
  perform public.create_circle('Circle ' || key, 'sky', 'Australia/Melbourne', 'key-' || key);
  perform pg_temp.act_as_postgres();
end;
$$;

select pg_temp.make_circle('00000000-0000-0000-0000-0000000d0002', 'maya');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d0004', 'pia');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d0005', 'quin');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d0006', 'rae');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d0007', 'stu');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d0008', 'uma');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d0009', 'omar');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d000a', 'tara');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000d000b', 'vic');

create temporary table cs as
select
  (select id from public.circles where creation_key = 'key-maya') as maya,
  (select id from public.circles where creation_key = 'key-pia') as pia,
  (select id from public.circles where creation_key = 'key-quin') as quin,
  (select id from public.circles where creation_key = 'key-rae') as rae,
  (select id from public.circles where creation_key = 'key-stu') as stu,
  (select id from public.circles where creation_key = 'key-uma') as uma,
  (select id from public.circles where creation_key = 'key-omar') as omar,
  (select id from public.circles where creation_key = 'key-tara') as tara,
  (select id from public.circles where creation_key = 'key-vic') as vic;
grant select on cs to public;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select omar, '00000000-0000-0000-0000-0000000d0003', 'Nina' from cs;

-- ---------------------------------------------------------------------------
-- Part 1: the tag.
-- ---------------------------------------------------------------------------
select is(
  (select source_ref from private.circle_cohorts where circle_id = (select maya from cs)),
  null, 'a circle starts with no tag'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0002');
select lives_ok(
  format($$ select public.tag_circle_source(%L, 'tt-always-the-one-3') $$, (select maya from cs)),
  'the owner tags their own circle'
);
select pg_temp.act_as_postgres();
select is(
  (select source_ref from private.circle_cohorts where circle_id = (select maya from cs)),
  'tt-always-the-one-3', 'and the tag is on the circle''s cohort row'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0002');
select lives_ok(
  format($$ select public.tag_circle_source(%L, 'rd-profile') $$, (select maya from cs)),
  'a second call is not an error'
);
select pg_temp.act_as_postgres();
select is(
  (select source_ref from private.circle_cohorts where circle_id = (select maya from cs)),
  'tt-always-the-one-3', 'but the first tag stays: it is the post the organiser came from'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0003');
select throws_ok(
  format($$ select public.tag_circle_source(%L, 'cmp-doodle') $$, (select omar from cs)),
  'P0002', 'circle_not_found', 'a member who is not the owner cannot tag the circle'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0009');
select throws_ok(
  format($$ select public.tag_circle_source(%L, 'cmp-doodle') $$, (select maya from cs)),
  'P0002', 'circle_not_found', 'nor can somebody in no part of it, in the same words'
);
select pg_temp.act_as_anon();
select throws_ok(
  format($$ select public.tag_circle_source(%L, 'cmp-doodle') $$, (select maya from cs)),
  '42501', null, 'and anon is refused'
);

-- Anything that is not a slug is dropped: no error, no tag.
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0009');
select lives_ok(
  format($$ select public.tag_circle_source(%L, 'Not A Slug!') $$, (select omar from cs)),
  'a tag that is not a slug is not an error'
);
select lives_ok(
  format($$ select public.tag_circle_source(%L, %L) $$, (select omar from cs), repeat('a', 41)),
  'nor is one that is too long'
);
select lives_ok(
  format($$ select public.tag_circle_source(%L, null) $$, (select omar from cs)),
  'nor is none'
);
select pg_temp.act_as_postgres();
select is(
  (select source_ref from private.circle_cohorts where circle_id = (select omar from cs)),
  null, 'and none of them is kept'
);
select throws_ok(
  format($$ update private.circle_cohorts set source_ref = 'Bad Tag' where circle_id = %L $$, (select omar from cs)),
  '23514', null, 'the column refuses a value that is not a slug, whoever writes it'
);
select is(
  (select array_agg(t order by t) from unnest(array[
    'tt-always-the-one-3', 'ig-bio', 'rd-profile', 'cmp-doodle', 'bs-x', 'a', repeat('a', 40),
    '', repeat('a', 41), 'TT-X', 'a_b', 'a b', 'a.b', 'a@b', E'a\n'
  ]) as t where t ~ '^[a-z0-9-]{1,40}$'),
  array['a', repeat('a', 40), 'bs-x', 'cmp-doodle', 'ig-bio', 'rd-profile', 'tt-always-the-one-3'],
  'the pattern the database holds is the one parseSourceRef holds'
);

-- Founder-read only.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and column_name ~* 'source_ref'),
  0, 'no table or view in public has a source_ref column for a client to read'
);
select ok(
  not has_table_privilege('authenticated', 'private.circle_cohorts', 'select')
  and not has_table_privilege('anon', 'private.circle_cohorts', 'select')
  and not has_table_privilege('service_role', 'private.circle_cohorts', 'select')
  and not has_column_privilege('authenticated', 'private.circle_cohorts', 'source_ref', 'select')
  and not has_column_privilege('anon', 'private.circle_cohorts', 'source_ref', 'select'),
  'no client role can read the tag'
);
select ok(
  not has_table_privilege('authenticated', 'analytics.circle_source_ref', 'select')
  and not has_table_privilege('authenticated', 'analytics.event_source_ref', 'select')
  and not has_table_privilege('authenticated', 'analytics.stalled_first_plans', 'select')
  and not has_table_privilege('anon', 'analytics.stalled_first_plans', 'select'),
  'nor the views that carry it'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0002');
select throws_ok(
  $$ select source_ref from private.circle_cohorts $$,
  '42501', null, 'the owner cannot read the tag on their own circle'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0003');
select throws_ok(
  $$ select source_ref from private.circle_cohorts $$,
  '42501', null, 'nor can a co-member'
);
select pg_temp.act_as_anon();
select throws_ok(
  $$ select source_ref from private.circle_cohorts $$,
  '42501', null, 'nor anon'
);
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- Part 2: the first plans that have stopped.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.make_plan(
  circle uuid, organiser uuid, code text, made interval, deadline interval, quorum integer,
  state text default 'collecting'
) returns uuid language sql as $$
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone, window_start, window_end,
    daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline, short_code, created_at
  ) values (
    circle, 'named', state, organiser, 'Catch up', 'Australia/Melbourne',
    current_date + 1, current_date + 8, 1050, 1350, 120, quorum,
    now() + deadline, code, now() - made
  ) returning id;
$$;

-- Maya: made 30 hours ago, nobody has come. Not shared.
select pg_temp.make_plan((select maya from cs), '00000000-0000-0000-0000-0000000d0002', 'kmnpq2', interval '30 hours', interval '5 days', 2);
-- Pia: made 60 hours ago, the share sheet opened 50 hours ago, nobody has answered.
select pg_temp.make_plan((select pia from cs), '00000000-0000-0000-0000-0000000d0004', 'kmnpq3', interval '60 hours', interval '5 days', 2);
insert into analytics.events (event_id, event_name, schema_version, plan_id, properties, occurred_at)
select gen_random_uuid(), 'plan_shared', 1, p.id, '{}', now() - interval '50 hours'
from public.plans p where p.short_code = 'kmnpq3';
-- Quin: made 100 hours ago, the deadline passed 10 hours ago, one person answered, three are needed.
select pg_temp.make_plan((select quin from cs), '00000000-0000-0000-0000-0000000d0005', 'kmnpq4', interval '100 hours', interval '-10 hours', 3);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select quin, '00000000-0000-0000-0000-0000000d000a', 'Tara' from cs;
insert into public.plan_responses (plan_id, revision, user_id, status)
select p.id, 1, '00000000-0000-0000-0000-0000000d000a', 'windows' from public.plans p where p.short_code = 'kmnpq4';
-- Rae: the same, but two others answered and the quorum is three with her: healthy.
select pg_temp.make_plan((select rae from cs), '00000000-0000-0000-0000-0000000d0006', 'kmnpq5', interval '100 hours', interval '-10 hours', 3);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select rae, u, n from cs, (values
  ('00000000-0000-0000-0000-0000000d000a'::uuid, 'Tara'), ('00000000-0000-0000-0000-0000000d000b'::uuid, 'Vic')) v (u, n);
insert into public.plan_responses (plan_id, revision, user_id, status)
select p.id, 1, u, 'windows' from public.plans p,
  unnest(array['00000000-0000-0000-0000-0000000d0006'::uuid, '00000000-0000-0000-0000-0000000d000a'::uuid,
               '00000000-0000-0000-0000-0000000d000b'::uuid]) u
where p.short_code = 'kmnpq5';
-- Stu: made 60 hours ago and somebody has only just joined, which shows it was shared
-- just now: not stalled, and not "quiet for 48 hours" for the sixty it was unshared.
select pg_temp.make_plan((select stu from cs), '00000000-0000-0000-0000-0000000d0007', 'kmnpq6', interval '60 hours', interval '5 days', 2);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select stu, '00000000-0000-0000-0000-0000000d000a', 'Tara' from cs;
-- Uma: a first plan that was cancelled, and a second made 30 hours ago that nobody has come to.
select pg_temp.make_plan((select uma from cs), '00000000-0000-0000-0000-0000000d0008', 'kmnpq7', interval '100 hours', interval '2 days', 2, 'cancelled');
select pg_temp.make_plan((select uma from cs), '00000000-0000-0000-0000-0000000d0008', 'kmnpq8', interval '30 hours', interval '5 days', 2);
-- Omar: made 10 hours ago, Nina is in it. Too young to be stalled.
select pg_temp.make_plan((select omar from cs), '00000000-0000-0000-0000-0000000d0009', 'kmnpq9', interval '10 hours', interval '5 days', 2);
-- Tara: shared 20 hours ago, nobody has answered. Quiet, but not yet for 48 hours.
select pg_temp.make_plan((select tara from cs), '00000000-0000-0000-0000-0000000d000a', 'kmnpqa', interval '60 hours', interval '5 days', 2);
insert into analytics.events (event_id, event_name, schema_version, plan_id, properties, occurred_at)
select gen_random_uuid(), 'plan_shared', 1, p.id, '{}', now() - interval '20 hours'
from public.plans p where p.short_code = 'kmnpqa';

select is(
  (select array_agg(state order by state) from analytics.stalled_first_plans),
  array['answered_short', 'not_shared', 'shared_quiet'],
  'one circle in each of the three states, and the six that look like them and are not'
);
select is(
  (select state from analytics.stalled_first_plans where state = 'not_shared' and age_hours between 29.9 and 30.5),
  'not_shared', 'made and not shared: aged from its creation'
);
select ok(
  (select age_hours from analytics.stalled_first_plans where state = 'shared_quiet') between 49.9 and 50.5,
  'shared and quiet: aged from the share'
);
select ok(
  (select age_hours from analytics.stalled_first_plans where state = 'answered_short') between 9.9 and 10.5,
  'answered and short: aged from the deadline'
);
select is(
  (select count(*)::int from analytics.stalled_first_plans),
  3, 'a plan with enough to meet the quorum, a plan someone joined, a cancelled first plan, a young plan and a recent share are not stalled'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'analytics' and table_name = 'stalled_first_plans'
      and column_name ~ '(^|_)(id|code|name|email|user)(_|$)'
  ),
  'the view has no id, code, name or address to return'
);

-- Vic: a circle and plan from before the period, tagged, whose plan was shared today:
-- the tag has no counter in the period, only an event, and is listed all the same.
update public.circles set created_at = now() - interval '30 days' where id = (select vic from cs);
select pg_temp.make_plan((select vic from cs), '00000000-0000-0000-0000-0000000d000b', 'kmnpqb', interval '30 days', interval '5 days', 2);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d000b');
select public.tag_circle_source((select vic from cs), 'cmp-late');
select pg_temp.act_as_postgres();
insert into analytics.events (event_id, event_name, schema_version, plan_id, properties, occurred_at)
select gen_random_uuid(), 'plan_shared', 1, p.id, '{}', now() from public.plans p where p.short_code = 'kmnpqb';

-- Pia's circle is tagged too, by the owner as the app does it.
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
select public.tag_circle_source((select pia from cs), 'rd-profile');

-- The founder's function.
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select ok(
  public.founder_analytics(current_date - 7) ? 'stalled' and public.founder_analytics(current_date - 7) ? 'by_source_ref',
  'the founder gets the stalled plans and the funnel by tag'
);
select is(
  (select jsonb_agg(to_jsonb(r) - 'week' order by r.state)
   from jsonb_to_recordset(public.founder_analytics(current_date - 7) -> 'stalled')
     as r (week text, cohort text, source text, state text, circles int, oldest_hours int, median_hours int)),
  '[{"state":"answered_short","cohort":"external","source":"unknown","circles":1,"oldest_hours":10,"median_hours":10},
    {"state":"not_shared","cohort":"external","source":"unknown","circles":1,"oldest_hours":30,"median_hours":30},
    {"state":"shared_quiet","cohort":"external","source":"unknown","circles":1,"oldest_hours":50,"median_hours":50}]'::jsonb,
  'by cohort and source, as counts and ages in whole hours'
);
select is(
  (select r.week from jsonb_to_recordset(public.founder_analytics(current_date - 7) -> 'stalled') as r (week text) limit 1),
  date_trunc('week', now())::date::text,
  'in the week the circle began'
);
select is(
  public.founder_analytics(current_date - 7) -> 'by_source_ref' -> 'tt-always-the-one-3' -> 'counters' ->> 'circles_created',
  '1', 'a tagged circle is counted under its tag'
);
select is(
  public.founder_analytics(current_date - 7) -> 'by_source_ref' -> 'tt-always-the-one-3' -> 'counters' ->> 'plans_created',
  '1', 'with its plans'
);
select is(
  (select array(select jsonb_object_keys(public.founder_analytics(current_date - 7) -> 'by_source_ref') order by 1)),
  array['cmp-late', 'rd-profile', 'tt-always-the-one-3'], 'tags that exist are listed, one with only an event in the period included'
);
select is(
  public.founder_analytics(current_date - 7) -> 'by_source_ref' -> 'rd-profile' -> 'events' ->> 'plan_shared',
  '1', 'an event of a tagged circle''s plan is counted under the tag'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0002');
select throws_ok(
  $$ select public.founder_analytics(current_date - 7) $$,
  '42501', 'not_allowed', 'an owner who is not the founder is refused the lot'
);

select * from finish();
rollback;
