-- SUS-240 (part 4), ADR 0085: the founder's "want a hand?" letter, once per
-- circle ever.
--
-- The candidates are the circles' first named plans that are still asking, 48
-- hours old or more, with an organiser, in an active circle that has never been
-- sent the letter. The decision writes the circle's row and the job together,
-- under the circle lock, and writes nothing a second time: not for the same
-- plan, not for a later plan in the same circle, not once somebody else has
-- answered. Only the service role can call either function or see the table.

begin;
select plan(21);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', now(), false, jsonb_build_object('is_anonymous', false),
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

-- Maya, Pia, Quin, Rae, Stu, Uma and Vic each own a circle; Nina is in some of them.
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0002', 'Pia');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0003', 'Quin');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0004', 'Rae');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0005', 'Stu');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0006', 'Uma');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0007', 'Vic');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0008', 'Nina');

create or replace function pg_temp.make_circle(owner uuid, key text)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(owner);
  perform public.create_circle('Circle ' || key, 'sky', 'Australia/Melbourne', 'key-' || key);
  perform pg_temp.act_as_postgres();
end;
$$;

select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0001', 'maya');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0002', 'pia');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0003', 'quin');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0004', 'rae');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0005', 'stu');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0006', 'uma');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0007', 'vic');

create temporary table cs as
select
  (select id from public.circles where creation_key = 'key-maya') as maya,
  (select id from public.circles where creation_key = 'key-pia') as pia,
  (select id from public.circles where creation_key = 'key-quin') as quin,
  (select id from public.circles where creation_key = 'key-rae') as rae,
  (select id from public.circles where creation_key = 'key-stu') as stu,
  (select id from public.circles where creation_key = 'key-uma') as uma,
  (select id from public.circles where creation_key = 'key-vic') as vic;
grant select on cs to public;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select c, '00000000-0000-0000-0000-0000000e0008', 'Nina'
from cs, unnest(array[maya, quin, rae]) c;

create or replace function pg_temp.make_plan(
  circle uuid, organiser uuid, code text, made interval, state text default 'collecting'
) returns uuid language sql as $$
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone, window_start, window_end,
    daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline, short_code, created_at
  ) values (
    circle, 'named', state, organiser, 'Catch up', 'Australia/Melbourne',
    current_date + 1, current_date + 8, 1050, 1350, 120, 2,
    now() + interval '5 days', code, now() - made
  ) returning id;
$$;

-- Maya: 50 hours, nobody has answered. The candidate.
select pg_temp.make_plan((select maya from cs), '00000000-0000-0000-0000-0000000e0001', 'kpqm22', interval '50 hours');
-- Pia: 30 hours. Too early.
select pg_temp.make_plan((select pia from cs), '00000000-0000-0000-0000-0000000e0002', 'kpqm23', interval '30 hours');
-- Quin: 60 hours, Nina has answered. Listed, with her answer counted: the domain decides.
select pg_temp.make_plan((select quin from cs), '00000000-0000-0000-0000-0000000e0003', 'kpqm24', interval '60 hours');
insert into public.plan_responses (plan_id, revision, user_id, status)
select p.id, 1, '00000000-0000-0000-0000-0000000e0008', 'windows' from public.plans p where p.short_code = 'kpqm24';
-- Rae: a first plan that was called off 70 hours ago, and a second, still asking, 60 hours old.
select pg_temp.make_plan((select rae from cs), '00000000-0000-0000-0000-0000000e0004', 'kpqm25', interval '70 hours', 'cancelled');
select pg_temp.make_plan((select rae from cs), '00000000-0000-0000-0000-0000000e0004', 'kpqm26', interval '60 hours');
-- Stu: 55 hours, and the one the "organiser letters are off" case uses.
select pg_temp.make_plan((select stu from cs), '00000000-0000-0000-0000-0000000e0005', 'kpqm27', interval '55 hours');
-- Uma: 80 hours, already sent.
select pg_temp.make_plan((select uma from cs), '00000000-0000-0000-0000-0000000e0006', 'kpqm28', interval '80 hours');
insert into private.first_plan_quiet_letters (circle_id, plan_id)
select uma, (select id from public.plans where short_code = 'kpqm28') from cs;
-- Vic: a first plan that ran out 90 hours ago. It has ended; it has not stalled.
select pg_temp.make_plan((select vic from cs), '00000000-0000-0000-0000-0000000e0007', 'kpqm29', interval '90 hours', 'expired');

-- 1-3: who can call what.
select ok(
  has_function_privilege('service_role', 'public.dispatch_first_plan_quiet_candidates(integer)', 'execute')
  and has_function_privilege('service_role', 'public.dispatch_first_plan_quiet(uuid, jsonb)', 'execute'),
  'the service role can read the candidates and decide the letter'
);
select ok(
  not has_function_privilege('authenticated', 'public.dispatch_first_plan_quiet_candidates(integer)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_first_plan_quiet_candidates(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_first_plan_quiet(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_first_plan_quiet(uuid, jsonb)', 'execute'),
  'neither anon nor a signed-in caller can call either'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
select throws_ok(
  $$ select count(*) from private.first_plan_quiet_letters $$,
  '42501', null, 'a signed-in member cannot read the cap table'
);
select pg_temp.act_as_anon();
select throws_ok(
  $$ select count(*) from private.first_plan_quiet_letters $$,
  '42501', null, 'nor anon'
);

-- 5-9: the candidates.
select pg_temp.act_as_service();
create temporary table cand as
select (x ->> 'plan_id')::uuid as plan_id
from jsonb_array_elements(public.dispatch_first_plan_quiet_candidates(50)) x;
grant select on cand to public;

select is(
  (select array_agg(p.short_code order by p.short_code) from cand c join public.plans p on p.id = c.plan_id),
  array['kpqm22', 'kpqm27'],
  'the first plans that are asking, 48 hours old, with an organiser, nobody else answering and no letter yet'
);
select is(
  (select count(*)::int from cand c join public.plans p on p.id = c.plan_id
   where p.short_code in ('kpqm23', 'kpqm24', 'kpqm25', 'kpqm26', 'kpqm28', 'kpqm29')),
  0, 'not too early, not one somebody else has answered, not a called-off first plan, not a second plan, not a circle already sent, not a plan that ran out'
);
select ok(
  (select public.dispatch_first_plan_quiet_candidates(50)::text !~ '@|short_code|kpqm|name')
  and not exists (
    select 1 from jsonb_array_elements(public.dispatch_first_plan_quiet_candidates(50)) x,
      jsonb_object_keys(x) k where k not in ('plan_id', 'created_ms')
  ),
  'and it returns an id and a time: no code, name or address'
);

-- 10-: the decision.
create temporary table c as
select public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000e0001') as maya,
       public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000e0003') as quin,
       public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000e0004') as rae;
grant select on c to public;

create or replace function pg_temp.job(plan_code text, contact uuid, key text, kind text default 'first_plan_quiet')
returns jsonb language sql security definer as $$
  select jsonb_build_array(jsonb_build_object(
    'channel', 'email', 'kind', kind, 'user_id', null, 'contact_id', contact,
    'plan_id', (select id from public.plans where short_code = plan_code), 'plan_revision', 1,
    'circle_id', null, 'confirmation_id', null,
    'scheduled_for', now() + interval '1 hour', 'idempotency_key', repeat(key, 64)))
$$;

select is(
  public.dispatch_first_plan_quiet(
    (select id from public.plans where short_code = 'kpqm22'),
    pg_temp.job('kpqm22', (select maya from c), 'a')),
  1, 'the first decision for a circle writes its job'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from private.first_plan_quiet_letters l
   where l.circle_id = (select maya from cs)
     and l.plan_id = (select id from public.plans where short_code = 'kpqm22')),
  1, 'and records that the circle has been decided'
);
select is(
  (select array[kind, status, plan_revision::text] from jobs.notification_jobs where idempotency_key = repeat('a', 64)),
  array['first_plan_quiet', 'scheduled', '1'],
  'a scheduled first_plan_quiet job, on the plan''s revision'
);

select pg_temp.act_as_service();
select is(
  public.dispatch_first_plan_quiet(
    (select id from public.plans where short_code = 'kpqm22'),
    pg_temp.job('kpqm22', (select maya from c), 'b')),
  null, 'a second call for the same plan decides nothing'
);

-- A later plan in the same circle: older than 48 hours, still asking, and not the first.
select pg_temp.act_as_postgres();
select pg_temp.make_plan((select maya from cs), '00000000-0000-0000-0000-0000000e0001', 'kpqm33', interval '52 hours');
select pg_temp.act_as_service();
select is(
  public.dispatch_first_plan_quiet(
    (select id from public.plans where short_code = 'kpqm33'),
    pg_temp.job('kpqm33', (select maya from c), 'c')),
  null, 'a second plan in the same circle is never sent the letter'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from jobs.notification_jobs where kind = 'first_plan_quiet'),
  1, 'so the circle has had exactly one letter'
);

-- Somebody else answered between the sweep's read and the decision.
select pg_temp.act_as_service();
select is(
  public.dispatch_first_plan_quiet(
    (select id from public.plans where short_code = 'kpqm24'),
    pg_temp.job('kpqm24', (select quin from c), 'd')),
  null, 'a plan somebody else has answered is not sent the letter, even if the sweep named it'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from private.first_plan_quiet_letters where circle_id = (select quin from cs)),
  0, 'and the circle is not marked, so nothing was decided'
);

-- A plan that is no longer its circle's first asking plan.
select pg_temp.act_as_service();
select is(
  public.dispatch_first_plan_quiet(
    (select id from public.plans where short_code = 'kpqm26'),
    pg_temp.job('kpqm26', (select rae from c), 'e')),
  null, 'the circle''s second plan, after a first that was called off, is not sent the letter'
);

-- A letter nobody wants is a decision too: no job, and the circle is spent.
select is(
  public.dispatch_first_plan_quiet((select id from public.plans where short_code = 'kpqm27'), '[]'::jsonb),
  0, 'with no job to write (organiser letters off, no address) the circle is still decided'
);
select pg_temp.act_as_postgres();
select ok(
  exists (select 1 from private.first_plan_quiet_letters where circle_id = (select stu from cs)),
  'and recorded, so a switch turned back on later does not send a stale letter'
);

-- A job of another kind, or for another plan, is refused rather than quietly written.
select pg_temp.act_as_service();
select throws_ok(
  format($$ select public.dispatch_first_plan_quiet(%L, %L::jsonb) $$,
    (select id from public.plans where short_code = 'kpqm27'),
    pg_temp.job('kpqm27', (select maya from c), 'f', 'replies_closed')::text),
  '23514', null, 'a job of another kind is refused'
);
select throws_ok(
  format($$ select public.dispatch_first_plan_quiet(%L, %L::jsonb) $$,
    (select id from public.plans where short_code = 'kpqm27'),
    pg_temp.job('kpqm22', (select maya from c), 'g')::text),
  '23514', null, 'and so is a job for another plan'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from jobs.notification_jobs where kind = 'first_plan_quiet'),
  1, 'after all of it, one letter in the whole database'
);

select * from finish();
rollback;
