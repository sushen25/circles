-- The engine's two ends: what it is given, and what happens to what it returns.
--
-- The engine itself is `packages/domain`'s and is tested there, with property
-- tests and a performance budget. Nothing here re-tests it. What is tested here
-- is the pair of claims the database makes about it:
--
--   * `engine_input` hands it a set of inputs that existed *together*, and
--     nothing belonging to somebody who is no longer in the circle;
--   * `store_candidate_set` writes a result only if the plan is still at the
--     version that result was computed from, and moves the plan between
--     `collecting` and `ready` in the same transaction as the set that decided
--     it.
--
-- The second is the whole of the ticket's "stale-result protection", and it is
-- the one thing here that cannot be checked by reading the code: two
-- recalculations racing is a thing to reproduce, not to reason about.

begin;
select plan(41);

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

-- Sunday Crew, four of them, in the order they joined — which is the order the
-- engine is given and therefore the order every available list comes back in.
select pg_temp.make_user('00000000-0000-0000-0000-0000000006a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000006a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000006a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000006a4', 'Departed');

select pg_temp.act_as('00000000-0000-0000-0000-0000000006a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-engine');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-engine';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot, joined_at)
select circle_id, '00000000-0000-0000-0000-0000000006a2'::uuid, 'Priya', now() + interval '1 minute' from t
union all
select circle_id, '00000000-0000-0000-0000-0000000006a3'::uuid, 'Tom', now() + interval '2 minutes' from t
union all
select circle_id, '00000000-0000-0000-0000-0000000006a4'::uuid, 'Departed', now() + interval '3 minutes' from t;

-- 2099 for the same reason every other suite uses it: a plan whose dates are
-- ahead of whatever clock the tests run on.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000006a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 3, timestamptz '2099-09-20T10:00:00Z', 'pnengn'
from t;

create temporary table tp as select id as plan_id from public.plans where short_code = 'pnengn';
grant select on tp to anon, authenticated, service_role;
create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select plan_id from tp $$;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, u from tp, unnest(array[
  '00000000-0000-0000-0000-0000000006a1'::uuid,
  '00000000-0000-0000-0000-0000000006a2'::uuid,
  '00000000-0000-0000-0000-0000000006a3'::uuid,
  '00000000-0000-0000-0000-0000000006a4'::uuid
]) as u;
insert into public.plan_required_members (plan_id, revision, user_id)
select plan_id, 1, '00000000-0000-0000-0000-0000000006a1'::uuid from tp;

-- One engine result, as the Edge Function sends it: the domain's own field
-- names, its instants as ISO strings. Parameterised by the two things the tests
-- vary — how many starts were eligible, and whether there are near-misses.
create or replace function pg_temp.result(
  eligible_count integer,
  near_misses integer default 0
) returns jsonb language sql as $$
  select jsonb_build_object(
    'scoringVersion', 1,
    'inputHash', 'testhash',
    'stats', jsonb_build_object(
      'startsConsidered', 40,
      'eligibleCount', eligible_count,
      'respondedCount', 3,
      'activeMemberCount', 4
    ),
    'eligible', case when eligible_count = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'start', '2099-09-17T08:30:00+00:00',
        'end', '2099-09-17T10:30:00+00:00',
        'availableUserIds', jsonb_build_array(
          '00000000-0000-0000-0000-0000000006a1',
          '00000000-0000-0000-0000-0000000006a2',
          '00000000-0000-0000-0000-0000000006a3'
        ),
        'explicitCount', 2,
        'flexibleCount', 1,
        'explanation', jsonb_build_object('code', 'best_attendance', 'count', 3)
      )
    ) end,
    'nearMisses', case when near_misses = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'start', '2099-09-18T08:30:00+00:00',
        'end', '2099-09-18T10:30:00+00:00',
        'availableUserIds', jsonb_build_array('00000000-0000-0000-0000-0000000006a2'),
        'explicitCount', 1,
        'flexibleCount', 0,
        'explanation', jsonb_build_object('code', 'closest', 'count', 1),
        'reason', jsonb_build_object('kind', 'quorum_short', 'by', 2)
      )
    ) end
  );
$$;

-- ---------------------------------------------------------------------------
-- Who may call these at all.
--
-- Both act for the engine, which is not a person and has no circle. The input
-- is every member's answer — the thing `plan_responses_select_own` exists to
-- keep from a client — and the output is a table clients may only read.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('authenticated', 'public.engine_input(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.engine_input(uuid)', 'execute'),
  'no client role can read the engine''s input: it is everybody''s answers at once'
);
select ok(
  not has_function_privilege('authenticated', 'public.store_candidate_set(uuid, integer, integer, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.store_candidate_set(uuid, integer, integer, jsonb)', 'execute'),
  'and none can write a candidate set'
);
select ok(
  has_function_privilege('service_role', 'public.engine_input(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.store_candidate_set(uuid, integer, integer, jsonb)', 'execute'),
  'the service role can, which is how the Edge Function reaches them'
);

-- ---------------------------------------------------------------------------
-- engine_input
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select is(
  (select public.engine_input(pg_temp.plan_id()) -> 'plan' ->> 'quorum'),
  '3',
  'the plan comes through as the engine''s vocabulary'
);

select is(
  (select public.engine_input(pg_temp.plan_id()) -> 'plan' -> 'required_member_ids'),
  jsonb_build_array('00000000-0000-0000-0000-0000000006a1'),
  'with who has to be there'
);

select is(
  (select public.engine_input(pg_temp.plan_id()) -> 'active_member_ids'),
  jsonb_build_array(
    '00000000-0000-0000-0000-0000000006a1',
    '00000000-0000-0000-0000-0000000006a2',
    '00000000-0000-0000-0000-0000000006a3',
    '00000000-0000-0000-0000-0000000006a4'
  ),
  'and the roster in joining order — which is the order every available list comes back in'
);

select is(
  (select jsonb_array_length(public.engine_input(pg_temp.plan_id()) -> 'responses')),
  0,
  'nobody has answered yet'
);

-- Priya paints 18:30–20:30 on the 17th; Tom is easy; Departed says none work.
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a2');
select public.replace_response(pg_temp.plan_id(), 1, 'windows', jsonb_build_array(jsonb_build_object(
  'start', timestamptz '2099-09-17T08:30:00Z', 'end', timestamptz '2099-09-17T10:30:00Z')));
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a3');
select public.replace_response(pg_temp.plan_id(), 1, 'flexible');
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a4');
select public.replace_response(pg_temp.plan_id(), 1, 'none_work');

select pg_temp.act_as_service();
select is(
  (select jsonb_agg(r ->> 'status' order by r ->> 'user_id')
   from jsonb_array_elements(public.engine_input(pg_temp.plan_id()) -> 'responses') as r),
  jsonb_build_array('windows', 'flexible', 'none_work'),
  'three answers, each as its own status'
);

select is(
  (select r -> 'windows' -> 0 ->> 'start'
   from jsonb_array_elements(public.engine_input(pg_temp.plan_id()) -> 'responses') as r
   where r ->> 'status' = 'windows'),
  '2099-09-17T08:30:00+00:00',
  'and the windows attached to the one that has them'
);

-- Somebody who leaves takes their answer with them. `on_member_removed` deletes
-- the response itself for an open plan; the join is the second line of defence,
-- and the one that matters for a plan where the trigger left the row alone.
select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t)
  and user_id = '00000000-0000-0000-0000-0000000006a4';

select pg_temp.act_as_service();
select is(
  (select jsonb_array_length(public.engine_input(pg_temp.plan_id()) -> 'responses')),
  2,
  'a member who has left is not among the answers'
);
select is(
  (select jsonb_array_length(public.engine_input(pg_temp.plan_id()) -> 'active_member_ids')),
  3,
  'nor among the people being asked'
);

-- ---------------------------------------------------------------------------
-- store_candidate_set — the compare-and-set
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
create or replace function pg_temp.version() returns integer
language sql security definer as $$ select input_version from public.plans where id = pg_temp.plan_id() $$;
create or replace function pg_temp.state() returns text
language sql security definer as $$ select state from public.plans where id = pg_temp.plan_id() $$;

select pg_temp.act_as_service();

-- A result computed one version ago. An answer landed while the engine ran, so
-- what it found is about a plan that no longer exists — and another
-- recalculation is already on its way for the answer that moved it.
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version() - 1, 1,
     pg_temp.result(4)) ->> 'stored'),
  'false',
  'a result from a version the plan has left is discarded'
);
select is(
  (select count(*)::integer from public.candidate_sets where plan_id = pg_temp.plan_id()),
  0,
  'and nothing is written'
);
select is(pg_temp.state(), 'collecting', 'and the plan does not move');

select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 2,
     pg_temp.result(4)) ->> 'stored'),
  'false',
  'nor is one from a revision the plan has left — a different question entirely'
);

-- ---------------------------------------------------------------------------
-- store_candidate_set — the write, and the state that follows it
-- ---------------------------------------------------------------------------
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(4)) ->> 'stored'),
  'true',
  'a result about the plan as it is, is stored'
);

select is(pg_temp.state(), 'ready', 'and the plan is ready: there are times to choose from');

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox
   where aggregate_id = pg_temp.plan_id() and event_name = 'scheduling.candidates_generated'),
  1,
  'which is announced once, by the transition rather than by the writer'
);

select is(
  (select array[cs.eligible_count, cs.responded_count, cs.active_member_count]
   from public.candidate_sets cs where cs.plan_id = pg_temp.plan_id()),
  array[4, 3, 4],
  'the engine''s own counts are kept beside the set'
);

select is(
  (select c.available_user_ids from public.candidates c
   join public.candidate_sets cs on cs.id = c.candidate_set_id
   where cs.plan_id = pg_temp.plan_id() and not c.is_near_miss),
  array[
    '00000000-0000-0000-0000-0000000006a1'::uuid,
    '00000000-0000-0000-0000-0000000006a2'::uuid,
    '00000000-0000-0000-0000-0000000006a3'::uuid
  ],
  'and the option keeps the order the engine put it in'
);

select is(
  (select c.rank from public.candidates c
   join public.candidate_sets cs on cs.id = c.candidate_set_id
   where cs.plan_id = pg_temp.plan_id() and not c.is_near_miss),
  1,
  'ranked from one, in the order the engine returned'
);

-- ---------------------------------------------------------------------------
-- store_candidate_set — the engine's version, and the trap in comparing it
--
-- `planning.candidate_is_eligible` requires the set's scoring version to equal
-- the plan's, and `plans.scoring_version` defaults to 1 and had no writer. The
-- first day the engine's own version became 2, every set would have been stored
-- with 2 against plans still saying 1, and `confirm` would have refused every
-- candidate on every plan while the screen went on showing them.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.act_as_service();

select lives_ok(
  format($$ select public.store_candidate_set(%L, %s, 1,
       jsonb_set(pg_temp.result(4), '{scoringVersion}', '2'::jsonb)) $$,
    pg_temp.plan_id(), pg_temp.version()),
  'a set from a newer engine is stored'
);

select pg_temp.act_as_postgres();
select is(
  (select scoring_version from public.plans where id = pg_temp.plan_id()),
  2,
  'and the plan is scored by the engine that scored it'
);

select ok(
  (select planning.candidate_is_eligible(p, '2099-09-17T08:30:00+00:00')
   from public.plans p where p.id = pg_temp.plan_id()),
  'so the candidate it produced can still be confirmed'
);

-- Back to where the rest of the file expects it.
select pg_temp.act_as_service();
select pg_temp.act_as_postgres();
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.act_as_service();
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(4)) ->> 'stored'),
  'true',
  'and an older one moves it back, because the engine that ran is the one that counts'
);

-- ---------------------------------------------------------------------------
-- store_candidate_set — one live set per revision
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.act_as_service();

select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(2)) ->> 'stored'),
  'true',
  'the next answer produces the next set'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.candidate_sets where plan_id = pg_temp.plan_id()),
  1,
  'which replaces the last one: a stale set is not history anybody reads'
);

select is(
  (select count(*)::integer from public.candidate_sets cs
   join public.plans p on p.id = cs.plan_id
   where cs.plan_id = pg_temp.plan_id() and cs.input_version = p.input_version),
  1,
  'and is current for the plan it belongs to'
);

-- ---------------------------------------------------------------------------
-- store_candidate_set — options that disappear
-- ---------------------------------------------------------------------------
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.act_as_service();

select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(0, 1)) ->> 'stored'),
  'true',
  'a recalculation that finds nothing is stored like any other'
);

select is(pg_temp.state(), 'collecting', 'and takes the plan back to collecting');

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox
   where aggregate_id = pg_temp.plan_id() and event_name = 'scheduling.no_eligible_candidates'),
  1,
  'announced once: the times the circle was being shown have gone'
);

select is(
  (select c.near_miss_reason from public.candidates c
   join public.candidate_sets cs on cs.id = c.candidate_set_id
   where cs.plan_id = pg_temp.plan_id() and c.is_near_miss),
  jsonb_build_object('kind', 'quorum_short', 'by', 2),
  'the near-miss carries the one rule that blocked it (spec §5.6)'
);

-- Still nothing, a second time. Nobody is told again: there is nothing left to
-- take away, and an event per answer per plan would say the same thing forever.
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.act_as_service();
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(0, 1)) ->> 'stored'),
  'true',
  'the next recalculation finds nothing either'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox
   where aggregate_id = pg_temp.plan_id() and event_name = 'scheduling.no_eligible_candidates'),
  1,
  'and says nothing, because nothing changed'
);

-- ---------------------------------------------------------------------------
-- candidate_summary — the three words a screen has, and the fourth it needs
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(0, 1)) ->> 'state'),
  'no_quorum',
  'nothing eligible and something close is the no-quorum screen'
);

select pg_temp.act_as_postgres();
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.act_as_service();
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(0, 0)) ->> 'state'),
  'collecting',
  'nothing eligible and nothing close is still waiting — members see nothing yet'
);

select pg_temp.act_as_postgres();
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.act_as_service();
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(3)) ->> 'state'),
  'ready',
  'and options are ready'
);

select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(3)) -> 'input_version')::integer,
  pg_temp.version(),
  'the summary says which version of the plan it describes'
);

-- A plan that has been called off is not collecting anything, and a caller who
-- asks about one should not be told that it is.
select pg_temp.act_as_postgres();
select planning.transition_plan(pg_temp.plan_id(), 'cancel',
  '00000000-0000-0000-0000-0000000006a1');

select pg_temp.act_as_service();
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(3)) ->> 'state'),
  'closed',
  'a cancelled plan is closed, and nothing is recalculated for it'
);
select is(
  (select public.store_candidate_set(pg_temp.plan_id(), pg_temp.version(), 1,
     pg_temp.result(3)) ->> 'stored'),
  'false',
  'which is the third way a result can be stale'
);

select pg_temp.act_as_service();
select throws_ok(
  $$ select public.store_candidate_set('00000000-0000-0000-0000-0000000000ff'::uuid, 1, 1, '{}'::jsonb) $$,
  'plan_not_found',
  'and a plan that is not there says so by name, not by SQLSTATE'
);

select * from finish();
rollback;
