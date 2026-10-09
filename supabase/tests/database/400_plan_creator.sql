-- SUS-177: who started a named plan is recorded durably, in the plan's own
-- transaction, kept past the audit log's 12 months, and readable only through
-- the founder's allowlisted function (and then as a count).

begin;
select plan(14);

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

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Maya owns the circle; Nina is a member; Sam is on the allowlist.
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0002', 'Nina');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0003', 'Sam');
insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-0000000e0003');

select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
create temporary table fixture as
select id as circle_id, (select id from public.create_circle('Book Club', 'sky', 'Australia/Melbourne', 'sus177b')) as other_id
from public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'sus177');
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select c, '00000000-0000-0000-0000-0000000e0002', 'Nina' from fixture, unnest(array[circle_id, other_id]) c;
create or replace function pg_temp.circle_id() returns uuid
language sql security definer as $$ select circle_id from fixture $$;
create or replace function pg_temp.other_id() returns uuid
language sql security definer as $$ select other_id from fixture $$;

-- Maya starts a plan, and then Nina does.
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
create temporary table first_plan as
select * from public.create_plan(pg_temp.circle_id(), 'Catch up', 'catch_up',
  date '2099-09-17', date '2099-09-20', 1050, 1350, 120, null, timestamptz '2099-09-16T10:00:00Z');
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0002');
create temporary table second_plan as
select * from public.create_plan(pg_temp.other_id(), 'Dinner', 'dinner',
  date '2099-09-17', date '2099-09-20', 1050, 1350, 120, null, timestamptz '2099-09-16T10:00:00Z');
select pg_temp.act_as_postgres();

select is(
  (select actor_user_id from private.audit_log where action = 'plan.created'
     and resource_id = (select id from first_plan)),
  '00000000-0000-0000-0000-0000000e0001'::uuid,
  'a plan created through create_plan has its creator recorded'
);
select is(
  (select actor_user_id from private.audit_log where action = 'plan.created'
     and resource_id = (select id from second_plan)),
  '00000000-0000-0000-0000-0000000e0002'::uuid,
  'and a second plan has its own creator'
);
select is(
  (select count(*)::integer from private.audit_log where action = 'plan.created'),
  2, 'one row per plan'
);
select is(
  (select occurred_at from private.audit_log where action = 'plan.created'
     and resource_id = (select id from first_plan)),
  (select created_at from first_plan),
  'at the moment the plan was created'
);
select is(
  (select metadata from private.audit_log where action = 'plan.created' limit 1),
  '{}'::jsonb,
  'holding ids and a time and nothing else'
);

-- A refused creation leaves no record: it shares the plan's transaction.
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
select throws_ok(
  $$ select public.create_plan(pg_temp.circle_id(), 'Late', 'catch_up',
       date '2099-09-17', date '2099-09-20', 1050, 1350, 120, null, timestamptz '2000-01-01T00:00:00Z') $$,
  'deadline_out_of_range', 'a plan that is refused...'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.audit_log where action = 'plan.created'),
  2, '...leaves no creator row behind'
);

-- The gate counts Nina's plan (she is not the owner) and not Maya's.
select is(
  (select coalesce(sum(plans), 0)::integer from analytics.gate_other_organiser),
  1, 'the organiser gate counts the plan somebody other than the owner started, and only it'
);

-- Retention: a year and a half on, the row is still there; an ordinary audit
-- row of the same age is not; and the row goes when its plan does.
update private.audit_log set occurred_at = now() - interval '18 months' where action = 'plan.created';
insert into private.audit_log (action, resource_type, occurred_at)
values ('circle.renamed', 'circle', now() - interval '18 months');
select jobs.run_retention();
select is(
  (select count(*)::integer from private.audit_log where action = 'plan.created'),
  2, 'the 30-day and 12-month cleanups leave who started a plan alone'
);
select is(
  (select count(*)::integer from private.audit_log where action = 'circle.renamed'),
  0, 'while an ordinary audit row of the same age goes'
);
delete from public.plans where id = (select id from second_plan);
select jobs.run_retention();
select is(
  (select array_agg(resource_id) from private.audit_log where action = 'plan.created'),
  array[(select id from first_plan)],
  'the creator row of a plan that no longer exists is removed'
);

-- Who can read it.
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
select throws_ok(
  $$ select * from private.audit_log $$, '42501', null,
  'a signed-in member cannot read the audit log'
);
select throws_ok(
  $$ select * from analytics.gate_other_organiser $$, '42501', null,
  'nor the gate view'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0003');
select ok(
  not (public.founder_analytics(current_date - 30))::text ~* '0000000e000',
  'the allowlisted founder gets a count through founder_analytics and no creator id'
);

select * from finish();
rollback;
