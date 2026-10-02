-- An edit that clears answers asks those people again (SUS-131, ADR 0046).
--
-- The dispatcher decides who hears `asked_again` from `dispatch_context`'s
-- `answered_earlier`, and whether to say anything at all from the event's
-- `action`. This proves the database half of both: the ids are the people who
-- answered an earlier revision and nobody else, no earlier answer comes with
-- them, an `edit` and an `adjust` are told apart on the event, and the job
-- table accepts the kind.

begin;
select plan(10);

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

-- Maya organises; Priya and Tom answer; Jess does not.
select pg_temp.make_user('00000000-0000-0000-0000-0000000027a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000027a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000027a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000027a4', 'Jess');

select pg_temp.act_as('00000000-0000-0000-0000-0000000027a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-asked-again');

select pg_temp.act_as_postgres();
create temporary table t as
  select id as circle_id from public.circles where creation_key = 'key-asked-again';
grant select on t to authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t, (values
  ('00000000-0000-0000-0000-0000000027a2'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-0000000027a3'::uuid, 'Tom'),
  ('00000000-0000-0000-0000-0000000027a4'::uuid, 'Jess')
) as u (id, name);

-- In 2099, so the deadline is ahead whenever this runs.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000027a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 3, timestamptz '2099-09-16T10:00:00Z', 'pnasked'
from t;
create temporary table tp as select id as plan_id from public.plans where short_code = 'pnasked';
grant select on tp to authenticated;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, u from tp, unnest(array[
  '00000000-0000-0000-0000-0000000027a1'::uuid, '00000000-0000-0000-0000-0000000027a2'::uuid,
  '00000000-0000-0000-0000-0000000027a3'::uuid, '00000000-0000-0000-0000-0000000027a4'::uuid
]) as u;

create or replace function pg_temp.answer(id uuid, revision integer)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(id);
  perform public.replace_response((select plan_id from tp), revision, 'flexible', '[]'::jsonb);
  perform pg_temp.act_as_postgres();
end;
$$;

create or replace function pg_temp.answered_earlier() returns uuid[] language sql as $$
  select coalesce(array_agg(value::uuid order by value), array[]::uuid[])
  from jsonb_array_elements_text(
    public.dispatch_context((select plan_id from tp)) -> 'answered_earlier');
$$;

create or replace function pg_temp.last_revised() returns jsonb language sql as $$
  select o.payload from jobs.outbox o
  where o.event_name = 'planning.plan_revised' and o.aggregate_id = (select plan_id from tp)
  order by o.seq desc limit 1;
$$;

select pg_temp.answer('00000000-0000-0000-0000-0000000027a2', 1);
select pg_temp.answer('00000000-0000-0000-0000-0000000027a3', 1);

select is(pg_temp.answered_earlier(), array[]::uuid[],
  'before any edit, nobody answered an earlier revision');

-- ---------------------------------------------------------------------------
-- An adjust: the same event, and no new question.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000027a1');
select public.revise_plan((select plan_id from tp), false, '{"quorum": 2}'::jsonb);
select pg_temp.act_as_postgres();

select is(pg_temp.last_revised() ->> 'action', 'adjust',
  'an adjustment says so on its event, which is how the dispatcher knows to ask nobody');
select is((pg_temp.last_revised() ->> 'revision')::integer, 1, 'and it keeps the revision');
select is(pg_temp.answered_earlier(), array[]::uuid[], 'so nobody has an earlier answer');

-- ---------------------------------------------------------------------------
-- An edit: a new question, and the people who answered the old one.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000027a1');
select public.revise_plan((select plan_id from tp), false, '{"window_end": "2099-09-21"}'::jsonb);
select pg_temp.act_as_postgres();

select is(pg_temp.last_revised() ->> 'action', 'edit', 'an edit says so on its event');
select is((pg_temp.last_revised() ->> 'revision')::integer, 2,
  'with the revision it moved the plan to, which keys one letter per revision');
select is(pg_temp.answered_earlier(),
  array['00000000-0000-0000-0000-0000000027a2', '00000000-0000-0000-0000-0000000027a3']::uuid[],
  'answered_earlier names Priya and Tom, whose times were cleared, and not Jess, who never answered');

select ok(
  not exists (
    select 1 from jsonb_array_elements(
      public.dispatch_context((select plan_id from tp)) -> 'answered_earlier') e
    where jsonb_typeof(e) <> 'string'
  ),
  'and names them only: no earlier answer, status or window comes with the ids'
);

select pg_temp.answer('00000000-0000-0000-0000-0000000027a3', 2);
select is(
  (select jsonb_agg(r -> 'user_id') from jsonb_array_elements(
    public.dispatch_context((select plan_id from tp)) -> 'responses') r),
  '["00000000-0000-0000-0000-0000000027a3"]'::jsonb,
  'Tom answering again shows as an answer to the current revision, which the audience rule leaves out'
);

-- ---------------------------------------------------------------------------
-- The job table.
-- ---------------------------------------------------------------------------

select ok(
  pg_get_constraintdef((select oid from pg_constraint where conname = 'notification_jobs_kind'))
    like '%''asked_again''%',
  'notification_jobs accepts the asked_again kind'
);

select * from finish();
rollback;
