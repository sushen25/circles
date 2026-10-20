-- Account deletion, the edges the first file does not reach (S4-05, ADR 0083):
-- an archived circle that still has an heir, a quiet plan's organiser, a named
-- plan whose organiser leaves, a token issued before the deletion, and a purge
-- of somebody who appears in a stored candidate set.

begin;
select plan(10);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid language sql as $$
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at)
  values (id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous, jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now())
  returning id;
$$;
create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
end; $$;
create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;

select pg_temp.make_user('51000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('51000000-0000-0000-0000-000000000002', 'Nina');
select pg_temp.make_user('51000000-0000-0000-0000-000000000003', 'Sam');

select pg_temp.act_as('51000000-0000-0000-0000-000000000001');
create temporary table crew as
select id as circle_id from public.create_circle('Edge Crew', 'sky', 'Australia/Melbourne', 'sus66-edge');
grant select on crew to authenticated;

select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot, joined_at)
select circle_id, u, n, now() - interval '1 day' from crew, (values
  ('51000000-0000-0000-0000-000000000002'::uuid, 'Nina'),
  ('51000000-0000-0000-0000-000000000003'::uuid, 'Sam')) as m(u, n);

-- A named plan and a quiet plan, both Maya's, and a stored candidate naming her.
insert into public.plans (circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local, duration_minutes, quorum,
  response_deadline, short_code)
select circle_id, 'named', 'collecting', '51000000-0000-0000-0000-000000000001', 'Catch up',
  'Australia/Melbourne', date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
  timestamptz '2099-09-16T10:00:00Z', 'pnsus66b' from crew;
create temporary table named_plan as select id from public.plans where short_code = 'pnsus66b';
insert into public.plan_participants (plan_id, revision, user_id)
select (select id from named_plan), 1, user_id from public.circle_members
where circle_id = (select circle_id from crew);

insert into public.candidate_sets (plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count)
select id, 1, 1, 1, 'h', 1, 1, 1, 3 from named_plan;
insert into public.candidates (candidate_set_id, is_near_miss, rank, starts_at, ends_at,
  available_user_ids, explicit_count, flexible_count, explanation_code, explanation_count,
  near_miss_reason)
select (select id from public.candidate_sets where plan_id = (select id from named_plan)),
  v.near, v.rk, timestamptz '2099-09-17T08:00:00Z' + (v.rk + v.near::integer) * interval '1 hour',
  timestamptz '2099-09-17T09:00:00Z' + (v.rk + v.near::integer) * interval '1 hour',
  array['51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002']::uuid[],
  2, 0, 'best_attendance', 0, v.reason
from (values
  (false, 1, null::jsonb),
  (true, 1, '{"kind": "required_missing", "userId": "51000000-0000-0000-0000-000000000001"}'::jsonb)
) as v(near, rk, reason);

-- An archived circle of Maya's that still has a saved-place member.
select pg_temp.act_as('51000000-0000-0000-0000-000000000001');
create temporary table old as
select id as circle_id from public.create_circle('Old Crew', 'plum', 'Australia/Melbourne', 'sus66-old');
grant select on old to authenticated;
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '51000000-0000-0000-0000-000000000002', 'Nina' from old;
update public.circles set status = 'archived' where id = (select circle_id from old);

select pg_temp.act_as('51000000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.account_deletion_preview()), 2,
  'the preview lists an archived circle too, so nothing is deleted unannounced');

select lives_ok($$select public.delete_account()$$, 'Maya deletes');
select pg_temp.act_as_postgres();
select is((select owner_user_id from public.circles where id = (select circle_id from old)),
  '51000000-0000-0000-0000-000000000002'::uuid,
  'an archived circle with an heir is handed on, not left to be deleted');
select is((select organiser_user_id from public.plans where id = (select id from named_plan)),
  '51000000-0000-0000-0000-000000000002'::uuid, 'the named plan goes to Nina');

-- A token issued before the deletion cannot make a circle.
select pg_temp.act_as('51000000-0000-0000-0000-000000000001');
select is(public.auth_is_permanent(), false, 'a deleted account is not a saved place any more');
select throws_ok($$select public.create_circle('After', 'sky', 'Australia/Melbourne', 'sus66-after')$$,
  null, null, 'and cannot make a circle on a token it still holds');

-- A named plan's organiser who leaves hands it on rather than stranding it.
select pg_temp.act_as_postgres();
update public.plans set organiser_user_id = '51000000-0000-0000-0000-000000000003'
where id = (select id from named_plan);
select pg_temp.act_as('51000000-0000-0000-0000-000000000003');
select lives_ok($$select public.leave_circle((select circle_id from crew))$$, 'the organiser leaves');
select pg_temp.act_as_postgres();
select is((select organiser_user_id from public.plans where id = (select id from named_plan)),
  '51000000-0000-0000-0000-000000000002'::uuid, 'the plan goes to Nina, not to somebody who left');

-- The purge copes with a stored candidate that names her.
update private.account_deletions set purge_after = now() - interval '1 day'
where user_id = '51000000-0000-0000-0000-000000000001';
select jobs.run_retention() as run \gset
select is(:'run'::jsonb -> 'failed_rules', '[]'::jsonb, 'the purge of somebody in a candidate set does not fail');
select is((select count(*)::integer from public.candidates c
           where c.available_user_ids @> array['51000000-0000-0000-0000-000000000001']::uuid[]
              or c.near_miss_reason::text like '%51000000-0000-0000-0000-000000000001%'), 0,
  'and no stored candidate names her');

select * from finish();
rollback;
