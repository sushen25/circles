-- Running a circle (S1-23): the owner's link shown again, the link reset, a
-- member removed, and the nudge switch a member keeps for themselves.
--
-- Sunday Crew: Maya owns it and has an account. Priya and Tom are guest
-- members who have answered the plan that is asking. Sam has an account and is
-- in a different circle.

begin;
select plan(44);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid
language sql
as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous,
    jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'),
    now(), now()
  )
  returning id;
$$;

create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text,
    true
  );
end;
$$;

create or replace function pg_temp.act_as_postgres()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select pg_temp.make_user('20000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('20000000-0000-0000-0000-000000000002', 'Priya', true);
select pg_temp.make_user('20000000-0000-0000-0000-000000000003', 'Tom', true);
select pg_temp.make_user('20000000-0000-0000-0000-000000000004', 'Sam');
select pg_temp.make_user('20000000-0000-0000-0000-000000000005', 'Ren', true);

-- Made the way `create-circle` makes it: a digest, and the id the secret was
-- derived from (ADR 00XX).
select pg_temp.act_as('20000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id
from public.create_circle(
  'Sunday Crew', 'sky', 'Australia/Melbourne', 'sus39-circle-admin', 'monthly',
  extensions.digest('first-secret', 'sha256'), '20000000-0000-0000-0000-0000000000f1'
);
grant select on fixture to authenticated;

select pg_temp.act_as_postgres();
select is(
  (select id from public.circle_invites where circle_id = (select circle_id from fixture)),
  '20000000-0000-0000-0000-0000000000f1'::uuid,
  'a circle''s first link carries the id its secret was derived from'
);

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u, n from fixture, (values
  ('20000000-0000-0000-0000-000000000002'::uuid, 'Priya'),
  ('20000000-0000-0000-0000-000000000003'::uuid, 'Tom')
) as m(u, n);

-- Sam's own circle, so he is somebody's member but not Sunday Crew's.
select pg_temp.act_as('20000000-0000-0000-0000-000000000004');
select public.create_circle('Book Club', 'plum', 'Australia/Melbourne', 'sus39-sam');

-- ---------------------------------------------------------------------------
-- live_invite: the owner's, and nobody else's.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('20000000-0000-0000-0000-000000000001');
select is(
  (select invite_id from public.live_invite((select circle_id from fixture))),
  '20000000-0000-0000-0000-0000000000f1'::uuid,
  'the owner is told which invite is live'
);
select is(
  (select secret_hash from public.live_invite((select circle_id from fixture))),
  extensions.digest('first-secret', 'sha256'),
  'and its digest, never the secret — the database does not have it'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select * from public.live_invite((select circle_id from fixture))$$,
  '42501', 'not_the_owner',
  'a member who is not the owner is refused'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select * from public.live_invite((select circle_id from fixture))$$,
  '42501', 'not_the_owner',
  'and so is somebody from another circle'
);

select ok(
  not has_function_privilege('anon', 'public.live_invite(uuid)', 'execute'),
  'anon cannot ask at all'
);

-- ---------------------------------------------------------------------------
-- Reset: the old link dies, nobody already in is touched.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.issue_invite((select circle_id from fixture), extensions.digest('mine', 'sha256'))$$,
  '42501', 'not_the_owner',
  'a member cannot reset the link'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.issue_invite(
      (select circle_id from fixture), extensions.digest('second-secret', 'sha256'),
      '20000000-0000-0000-0000-0000000000f2')$$,
  'the owner resets it, naming the new invite''s id'
);
select is(
  (select invite_id from public.live_invite((select circle_id from fixture))),
  '20000000-0000-0000-0000-0000000000f2'::uuid,
  'the new invite is the live one'
);
select is(
  (select count(*)::integer from public.live_invite((select circle_id from fixture))),
  1,
  'and the only one'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000005', true);
select throws_ok(
  $$select public.redeem_invite(extensions.digest('first-secret', 'sha256'), 'Ren')$$,
  'P0002', 'invite_inactive',
  'the old link answers invite_inactive'
);
select lives_ok(
  $$select public.redeem_invite(extensions.digest('second-secret', 'sha256'), 'Ren')$$,
  'the new one lets somebody in'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.circle_members
   where circle_id = (select circle_id from fixture) and status = 'active'),
  4,
  'everybody already in is still in, and the newcomer with them'
);
select is(
  (select count(*)::integer from jobs.outbox
   where event_name = 'circles.invite_rotated' and aggregate_id = (select circle_id from fixture)),
  1,
  'the reset is announced once; the first link was not'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.circles where id = (select circle_id from fixture)),
  1,
  'a member who joined by the old link still sees the circle'
);

-- ---------------------------------------------------------------------------
-- Removal.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();

-- A plan asking all of them, and two answers in it.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '20000000-0000-0000-0000-000000000001',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
  timestamptz '2099-09-16T10:00:00Z', 'pnremvx2'
from fixture;
create temporary table the_plan as select id from public.plans where short_code = 'pnremvx2';
grant select on the_plan to authenticated;
insert into public.plan_participants (plan_id, revision, user_id)
select (select id from the_plan), 1, m.user_id
from public.circle_members m where m.circle_id = (select circle_id from fixture) and m.status = 'active';

create or replace function pg_temp.answer(who uuid) returns void language plpgsql as $$
begin
  perform pg_temp.act_as(who, true);
  perform public.replace_response((select id from the_plan), 1, 'windows', jsonb_build_array(
    jsonb_build_object('start', '2099-09-17T08:00:00Z', 'end', '2099-09-17T10:00:00Z')));
end;
$$;
select pg_temp.answer('20000000-0000-0000-0000-000000000002');
select pg_temp.answer('20000000-0000-0000-0000-000000000003');

select pg_temp.act_as_postgres();
create temporary table before as select input_version from public.plans where short_code = 'pnremvx2';

select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.remove_member((select circle_id from fixture), '20000000-0000-0000-0000-000000000003')$$,
  '42501', 'not_the_owner',
  'a member cannot remove anybody'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.remove_member((select circle_id from fixture), '20000000-0000-0000-0000-000000000003')$$,
  '42501', 'not_the_owner',
  'nor can the owner of a different circle'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.remove_member((select circle_id from fixture), '20000000-0000-0000-0000-000000000001')$$,
  '23514', 'cannot_remove_owner',
  'the owner cannot remove themselves'
);
select throws_ok(
  $$select public.remove_member((select circle_id from fixture), '20000000-0000-0000-0000-000000000004')$$,
  'P0002', 'member_not_found',
  'somebody who was never in it is not found'
);

select is(
  public.remove_member((select circle_id from fixture), '20000000-0000-0000-0000-000000000003'),
  array[(select id from the_plan)],
  'the owner removes Tom, and is told which plan needs recalculating'
);

select throws_ok(
  $$select public.remove_member((select circle_id from fixture), '20000000-0000-0000-0000-000000000003')$$,
  'P0002', 'member_not_found',
  'removing him twice finds nobody the second time'
);

select pg_temp.act_as_postgres();
select is(
  (select status from public.circle_members
   where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000003'),
  'removed',
  'the membership is kept, marked removed, for history'
);
select is(
  (select count(*)::integer from public.plan_responses
   where plan_id = (select id from the_plan) and user_id = '20000000-0000-0000-0000-000000000003'),
  0,
  'his answer to the plan still asking is gone'
);
select is(
  (select count(*)::integer from public.plan_responses
   where plan_id = (select id from the_plan) and user_id = '20000000-0000-0000-0000-000000000002'),
  1,
  'and Priya''s is not'
);
select is(
  (select count(*)::integer from public.plan_participants
   where plan_id = (select id from the_plan) and user_id = '20000000-0000-0000-0000-000000000003'),
  0,
  'he is no longer somebody the plan is asking'
);
select ok(
  (select input_version from public.plans where short_code = 'pnremvx2') > (select input_version from before),
  'the plan''s input moved on, so no candidate set that counted him can be confirmed'
);
select is(
  (select count(*)::integer from jobs.outbox
   where event_name = 'circles.member_removed'
     and payload ->> 'user_id' = '20000000-0000-0000-0000-000000000003'),
  1,
  'circles.member_removed is emitted'
);
select is(
  (select count(*)::integer from private.audit_log
   where action = 'circles.member_removed' and actor_user_id = '20000000-0000-0000-0000-000000000001'
     and metadata ->> 'user_id' = '20000000-0000-0000-0000-000000000003'),
  1,
  'and who removed whom is in the audit log, by id'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000003', true);
select is(
  (select count(*)::integer from public.circles where id = (select circle_id from fixture)),
  0,
  'Tom can no longer see the circle'
);
select is(
  (select count(*)::integer from public.plans where short_code = 'pnremvx2'),
  0,
  'nor its plan'
);
select throws_ok(
  $$select public.replace_response((select id from the_plan), 1, 'windows', jsonb_build_array(
      jsonb_build_object('start', '2099-09-17T08:00:00Z', 'end', '2099-09-17T10:00:00Z')))$$,
  null, null,
  'nor answer it'
);

select ok(
  not has_function_privilege('anon', 'public.remove_member(uuid,uuid)', 'execute'),
  'anon cannot call remove_member'
);

-- ---------------------------------------------------------------------------
-- muted_nudges: a member's own switch.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
update public.circle_members set muted_nudges = true
where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000002';
update public.circle_members set muted_nudges = true
where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000001';

select pg_temp.act_as_postgres();
select is(
  (select muted_nudges from public.circle_members
   where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000002'),
  true,
  'a member turns nudges off for themselves'
);
select is(
  (select muted_nudges from public.circle_members
   where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000001'),
  false,
  'and cannot turn them off for somebody else'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000003', true);
update public.circle_members set muted_nudges = true
where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000003';
select pg_temp.act_as_postgres();
select is(
  (select muted_nudges from public.circle_members
   where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000003'),
  false,
  'a removed member cannot change their row at all'
);

select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$update public.circle_members set role = 'owner'
    where circle_id = (select circle_id from fixture) and user_id = '20000000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'the new grant is one column, not the row'
);

-- "Where, roughly": blank is no answer, and a paragraph is not an area.
select pg_temp.act_as('20000000-0000-0000-0000-000000000004');
select is(
  (select default_area from public.create_circle(
    'Walkers', 'moss', 'Australia/Melbourne', 'sus39-area-blank', 'none', null, null, '   ')),
  null,
  'a blank area is stored as no area'
);
select is(
  (select default_area from public.create_circle(
    'Runners', 'moss', 'Australia/Melbourne', 'sus39-area', 'none', null, null, ' Inner north ')),
  'Inner north',
  'and an area is kept, trimmed'
);
select throws_ok(
  $$update public.circles set default_area = repeat('x', 61) where name = 'Runners'$$,
  '23514', null,
  'an area longer than sixty characters is refused'
);

-- The owner's own switches, and archiving, are the owner's update through RLS.
select pg_temp.act_as('20000000-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.circles set cadence = 'fortnightly', nudge_policy = 'take_turns', color = 'moss'
    where id = (select circle_id from fixture)$$,
  'the owner changes the cadence, the nudge policy and the colour'
);
select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
update public.circles set status = 'archived' where id = (select circle_id from fixture);
select pg_temp.act_as_postgres();
select is(
  (select cadence || '/' || nudge_policy || '/' || color || '/' || status from public.circles
   where id = (select circle_id from fixture)),
  'fortnightly/take_turns/moss/active',
  'and a member archiving it changes nothing'
);

-- ---------------------------------------------------------------------------
-- own_email_hint: the caller's own address, never whole.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('20000000-0000-0000-0000-000000000001');
select is(
  public.own_email_hint(),
  '2…@example.com',
  'the owner is told the first character and the domain of their own address, and nothing more'
);
select pg_temp.act_as_postgres();
update auth.users set email = null where id = '20000000-0000-0000-0000-000000000002';
select pg_temp.act_as('20000000-0000-0000-0000-000000000002', true);
select is(public.own_email_hint(), null, 'a guest with no address is told nothing');
select ok(
  not has_function_privilege('anon', 'public.own_email_hint()', 'execute'),
  'and nobody without a session can ask'
);

select * from finish();
rollback;
