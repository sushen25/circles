-- Joining a circle from a plan's short code (ADR 0022, S1-24c).
--
-- A plan's code admits new members while the plan is taking answers, and the
-- join makes them somebody that plan is asking. Everything else about joining —
-- the cap, the name, rejoining after removal — is the invite's rules, through
-- `private.admit_member`.
--
-- Sunday Crew: Maya owns it and has an account. Priya is a guest member. Tom
-- joined through the invite after the plan was made, so the plan never asked
-- him. Kai was a member and was removed. Ren is a stranger with a guest
-- session; Sam is a stranger with an account.

begin;
select plan(63);

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

-- How `join-plan` calls it: as the service role, naming the person its JWT
-- resolved to.
create or replace function pg_temp.act_as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
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

select pg_temp.make_user('17000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('17000000-0000-0000-0000-000000000002', 'Priya', true);
select pg_temp.make_user('17000000-0000-0000-0000-000000000003', 'Tom', true);
select pg_temp.make_user('17000000-0000-0000-0000-000000000004', 'Kai', true);
select pg_temp.make_user('17000000-0000-0000-0000-000000000005', 'Ren', true);
select pg_temp.make_user('17000000-0000-0000-0000-000000000006', 'Sam');
select pg_temp.make_user('17000000-0000-0000-0000-000000000007', 'Ada', true);
select pg_temp.make_user('17000000-0000-0000-0000-000000000008', 'Bo', true);
select pg_temp.make_user('17000000-0000-0000-0000-000000000009', 'Cy', true);

select pg_temp.act_as('17000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id
from public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'sus79-join-plan');

select pg_temp.act_as_postgres();

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '17000000-0000-0000-0000-000000000002'::uuid, 'Priya' from fixture
union all
select circle_id, '17000000-0000-0000-0000-000000000004'::uuid, 'Kai' from fixture;

-- One plan for each state a code can be in. Only `pnaskng2` admits.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code, quiet_threshold
)
select circle_id, mode, state, organiser, 'Catch up', 'Australia/Melbourne',
  date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 3,
  deadline, code, threshold
from fixture, (values
  ('named', 'collecting', '17000000-0000-0000-0000-000000000001'::uuid, timestamptz '2099-09-16T10:00:00Z', 'pnaskng2', null::integer),
  ('named', 'collecting', '17000000-0000-0000-0000-000000000001'::uuid, now() - interval '1 minute', 'pnpassed', null),
  ('named', 'collecting', '17000000-0000-0000-0000-000000000001'::uuid, timestamptz '2099-09-16T10:00:00Z', 'pnready2', null),
  ('quiet', 'seeking', null, timestamptz '2099-09-16T10:00:00Z', 'pnqvet22', 2),
  ('named', 'confirmed', '17000000-0000-0000-0000-000000000001'::uuid, timestamptz '2099-09-16T10:00:00Z', 'pnsetxx2', null),
  ('named', 'cancelled', '17000000-0000-0000-0000-000000000001'::uuid, timestamptz '2099-09-16T10:00:00Z', 'pncanxx2', null),
  ('named', 'completed', '17000000-0000-0000-0000-000000000001'::uuid, timestamptz '2099-09-16T10:00:00Z', 'pndxne22', null)
) as p(mode, state, organiser, deadline, code, threshold);

create temporary table plan_ids as
select short_code, id from public.plans where short_code like 'pn%';
grant select on plan_ids, fixture to authenticated, service_role;

-- Maya, Priya and Kai were asked. Tom joins afterwards, so he was not.
insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, u from plan_ids, unnest(array[
  '17000000-0000-0000-0000-000000000001'::uuid,
  '17000000-0000-0000-0000-000000000002'::uuid,
  '17000000-0000-0000-0000-000000000004'::uuid
]) as u
where short_code = 'pnaskng2';

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '17000000-0000-0000-0000-000000000003'::uuid, 'Tom' from fixture;

-- Kai is removed, which takes him off the plan.
update public.circle_members set status = 'removed'
where user_id = '17000000-0000-0000-0000-000000000004';

create temporary table before as
select quorum, input_version from public.plans where short_code = 'pnaskng2';

create or replace function pg_temp.joined_events(who uuid)
returns bigint
language sql
as $$
  select count(*) from jobs.outbox o
  where o.event_name = 'circles.member_joined' and o.payload ->> 'user_id' = who::text;
$$;

-- ---------------------------------------------------------------------------
-- A stranger with a guest session.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnaskng2')$$,
  '23514', 'display_name_unusable',
  'a guest has to give a name'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnaskng2', 'Priya')$$,
  '23505', 'duplicate_name',
  'a name somebody in the circle already has is refused'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnaskng2', E'́́')$$,
  '23514', 'display_name_unusable',
  'a name of nothing but combining marks is refused'
);

select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnaskng2', 'Ren')$$,
  'a guest joins from the plan''s code'
);

select pg_temp.act_as_postgres();

select is(
  (select display_name_snapshot || '/' || status from public.circle_members
   where user_id = '17000000-0000-0000-0000-000000000005'),
  'Ren/active',
  'and is an active member under the name they gave'
);

select ok(
  exists (
    select 1 from public.plan_participants pp join plan_ids p on p.id = pp.plan_id
    where p.short_code = 'pnaskng2' and pp.revision = 1
      and pp.user_id = '17000000-0000-0000-0000-000000000005'
  ),
  'and is somebody the plan is asking'
);

select is(
  pg_temp.joined_events('17000000-0000-0000-0000-000000000005'), 1::bigint,
  'the join is announced once, by the membership trigger'
);

select is(
  (select quorum from public.plans where short_code = 'pnaskng2'),
  (select quorum from before),
  'the quorum does not move (ADR 0017, ADR 0022)'
);

select is(
  (select input_version from public.plans where short_code = 'pnaskng2'),
  (select input_version + 1 from before),
  'the input version does: the plan is asking one more person'
);

select pg_temp.act_as('17000000-0000-0000-0000-000000000005', true);

select lives_ok(
  format($$select public.replace_response(%L, 1, 'flexible')$$,
    (select id from plan_ids where short_code = 'pnaskng2')),
  'and they can answer it'
);

select pg_temp.act_as_service();

select is(
  (public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnaskng2', 'Somebody Else') -> 'newly_asked')::boolean,
  false,
  'opening the link again adds nothing'
);

select pg_temp.act_as_postgres();

select is(
  (select display_name_snapshot from public.circle_members
   where user_id = '17000000-0000-0000-0000-000000000005'),
  'Ren',
  'and does not rename them'
);

select is(
  (select count(*) from public.circle_members
   where user_id = '17000000-0000-0000-0000-000000000005'),
  1::bigint,
  'nor make a second membership'
);

select is(
  pg_temp.joined_events('17000000-0000-0000-0000-000000000005'), 1::bigint,
  'nor announce a second join'
);

-- The answer bumped the version once; the repeat must not have bumped it again.
select is(
  (select input_version from public.plans where short_code = 'pnaskng2'),
  (select input_version + 2 from before),
  'nor bump the input version, so an organiser''s set is not replaced'
);

-- A ready plan asking somebody new has no current candidate set until the
-- recalculation lands — and `join-plan` tolerates that recalculation failing.
-- Left `ready`, every screen and job would read a set `confirm` refuses as stale.
--
-- Made ready here rather than in the fixture: Kai's removal above sends every
-- ready plan in the circle back to collecting, for the same reason.
select pg_temp.act_as_postgres();
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'ready' where short_code = 'pnready2';
select set_config('circles.in_transition', 'off', true);

select is(
  (select state from public.plans where short_code = 'pnready2'),
  'ready',
  'a plan that is ready before anybody new is asked'
);

select pg_temp.act_as_service();

select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnready2')$$,
  'a member opens a ready plan''s link and is asked by it'
);

select pg_temp.act_as_postgres();

select is(
  (select state from public.plans where short_code = 'pnready2'),
  'collecting',
  'and the plan goes back to collecting, as it does when an answer moves, until the set is recalculated'
);

-- ---------------------------------------------------------------------------
-- A stranger with an account.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();

select is(
  (public.join_from_plan('17000000-0000-0000-0000-000000000006', 'pnaskng2') -> 'newly_asked')::boolean,
  true,
  'an account joins with no name'
);

select pg_temp.act_as_postgres();

select is(
  (select display_name_snapshot from public.circle_members
   where user_id = '17000000-0000-0000-0000-000000000006'),
  'Sam',
  'under their profile''s name'
);

-- ---------------------------------------------------------------------------
-- A member the plan never asked.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('17000000-0000-0000-0000-000000000003', true);

select throws_ok(
  format($$select public.replace_response(%L, 1, 'flexible')$$,
    (select id from plan_ids where short_code = 'pnaskng2')),
  '42501', 'not_a_participant',
  'Tom joined after the plan was made, so it is not asking him'
);

select pg_temp.act_as_service();

select is(
  (public.join_from_plan('17000000-0000-0000-0000-000000000003', 'pnaskng2') -> 'newly_asked')::boolean,
  true,
  'opening its link asks him, and needs no name'
);

select pg_temp.act_as('17000000-0000-0000-0000-000000000003', true);

select lives_ok(
  format($$select public.replace_response(%L, 1, 'flexible')$$,
    (select id from plan_ids where short_code = 'pnaskng2')),
  'and now he can answer'
);

select pg_temp.act_as_postgres();

select is(
  (select count(*) from public.circle_members
   where user_id = '17000000-0000-0000-0000-000000000003'),
  1::bigint,
  'with no second membership'
);

select is(
  pg_temp.joined_events('17000000-0000-0000-0000-000000000003'), 1::bigint,
  'and no second join announced: the only one is from when he joined'
);

-- ---------------------------------------------------------------------------
-- A removed member.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();

select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000004', 'pnaskng2', 'Kai')$$,
  'a removed member rejoins through a live plan link, as through a live invite'
);

select pg_temp.act_as_postgres();

select is(
  (select status from public.circle_members
   where user_id = '17000000-0000-0000-0000-000000000004'),
  'active',
  'and is active again'
);

-- ---------------------------------------------------------------------------
-- Codes that do not admit. One answer for all of them.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pnpassed', 'Ada')$$,
  'P0002', 'invite_inactive',
  'a plan still collecting whose deadline has passed'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pnqvet22', 'Ada')$$,
  'P0002', 'invite_inactive',
  'a quiet ask still gathering interest'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pnsetxx2', 'Ada')$$,
  'P0002', 'invite_inactive',
  'a confirmed plan'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pncanxx2', 'Ada')$$,
  'P0002', 'invite_inactive',
  'a cancelled plan'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pndxne22', 'Ada')$$,
  'P0002', 'invite_inactive',
  'a completed plan'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pnnxbdy2', 'Ada')$$,
  'P0002', 'invite_inactive',
  'a code that does not exist'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'not a code!', 'Ada')$$,
  'P0002', 'invite_inactive',
  'something that is not a code at all'
);

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pnqvet22')$$,
  'P0002', 'invite_inactive',
  'refused before a missing name is: the refusal does not depend on what else was sent'
);

select pg_temp.act_as_service();

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000002', 'pnsetxx2')$$,
  'P0002', 'invite_inactive',
  'a member gets the same refusal from a plan that is not asking'
);

select pg_temp.act_as_postgres();

select is(
  (select count(*) from public.circle_members
   where user_id = '17000000-0000-0000-0000-000000000007'),
  0::bigint,
  'and nobody was let in by any of them'
);

-- ---------------------------------------------------------------------------
-- An archived circle, and a full one.
-- ---------------------------------------------------------------------------

update public.circles set status = 'archived' where id = (select circle_id from fixture);

select pg_temp.act_as_service();

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000008', 'pnaskng2', 'Bo')$$,
  'P0002', 'invite_inactive',
  'a plan still asking, in a circle that has been archived'
);

select pg_temp.act_as_postgres();

update public.circles set status = 'active' where id = (select circle_id from fixture);

-- Fill it to the cap with guests nobody will meet again.
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', null, true, '{"is_anonymous": true}', '{"sus79_filler": true}', now(), now()
from generate_series(
  1,
  public.member_cap() - (select count(*)::integer from public.circle_members m, fixture f
                         where m.circle_id = f.circle_id and m.status = 'active')
);

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select f.circle_id, u.id, 'Filler ' || row_number() over ()
from auth.users u, fixture f
where u.raw_user_meta_data ? 'sus79_filler';

select pg_temp.act_as_service();

select throws_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000009', 'pnaskng2', 'Cy')$$,
  '23514', 'circle_full',
  'a full circle says so, with its own reason'
);

-- ---------------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();

select ok(
  has_function_privilege('service_role', 'public.join_from_plan(uuid, text, text)', 'execute'),
  'join-plan may call it, as the service role'
);

-- The finding this exists for. Granted to `authenticated`, any session — an
-- anonymous one costs nothing — could call the RPC directly, as often as it
-- liked, without Turnstile or either limit, and each guess that landed was a
-- seat in a circle.
select ok(
  not has_function_privilege('authenticated', 'public.join_from_plan(uuid, text, text)', 'execute'),
  'but no client can, guest or account, so the Turnstile check and the limits cannot be skipped'
);

select ok(
  not has_function_privilege('anon', 'public.join_from_plan(uuid, text, text)', 'execute'),
  'nor anybody without a session'
);

select ok(
  not has_function_privilege('authenticated', 'private.admit_member(uuid, uuid, text)', 'execute'),
  'and the shared rules are not a way around either door'
);

-- ---------------------------------------------------------------------------
-- A quorum nobody chose follows the circle (ADR 0026, SUS-85)
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();

-- A circle of one with a plan whose quorum was never chosen: what first run
-- makes, a second after the circle exists.
select pg_temp.act_as('17000000-0000-0000-0000-000000000006');
create temporary table alone as
select id as circle_id
from public.create_circle('Walkies', 'sky', 'Australia/Melbourne', 'sus85-soft');

select pg_temp.act_as_postgres();
create temporary table alone_plan as
with made as (
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, quorum_source, response_deadline, short_code
  )
  select circle_id, 'named', 'collecting', '17000000-0000-0000-0000-000000000006'::uuid,
    'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-30', 1050, 1350,
    120, public.soft_quorum(1), 'defaulted', timestamptz '2099-09-16T10:00:00Z', 'pnwakes2'
  from alone
  returning id
)
select id as plan_id from made;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, '17000000-0000-0000-0000-000000000006'::uuid from alone_plan;

-- Read through a definer, as the fixtures above are: the service role the join
-- runs as cannot select from another role's temporary table.
create or replace function pg_temp.walkies_plan() returns uuid
language sql security definer as $$ select plan_id from alone_plan $$;

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  3,
  'a plan made on a circle of one asks for three, not two'
);

select pg_temp.act_as_service();

-- Ada taps the link: two members now, and the floor still holds.
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000007', 'pnwakes2', 'Ada')$$,
  'somebody new joins from the plan link'
);

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  3,
  'the quorum holds at the floor while the circle is small'
);

select is(
  (select revision from public.plans p where p.id = pg_temp.walkies_plan()),
  1,
  'and nobody was asked again: the revision never moved'
);

-- Bo and Cy make it five, then the majority passes the floor at six.
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000008', 'pnwakes2', 'Bo')$$,
  'a third joins'
);
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000009', 'pnwakes2', 'Cy')$$,
  'a fourth joins'
);

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  public.soft_quorum(4),
  'the quorum follows the circle as people arrive'
);

-- Past the floor, where the number actually moves: five and six members make
-- the 60% majority the larger of the two. The first version of this test
-- stopped at four, where `soft_quorum` is still 3, so the write it is about
-- never ran — and the transition it goes through was refused as an
-- unannounced one the moment it did.
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000002', 'pnwakes2', 'Priya')$$,
  'a fifth joins'
);
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000004', 'pnwakes2', 'Kai')$$,
  'a sixth joins'
);

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  4,
  'and at six the majority passes the floor: the quorum is 4'
);

select is(
  (select revision from public.plans p where p.id = pg_temp.walkies_plan()),
  1,
  'still one revision: a quorum that moved asked nobody again (ADR 0017)'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.aggregate_id = pg_temp.walkies_plan() and o.event_name = 'planning.plan_revised'),
  0,
  'and the circle was not told the plan changed on every join'
);

select is(
  (select count(*)::integer from public.plan_responses r where r.plan_id = pg_temp.walkies_plan()),
  0,
  'and no answer was discarded on the way'
);

-- A member of the circle who opens the plan for the first time *is* somebody
-- the plan is now asking, even though no membership was written: the audience
-- grew, so the number follows it (review round 3).
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '17000000-0000-0000-0000-000000000001'::uuid, 'Maya' from alone;

select pg_temp.act_as_service();
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000001', 'pnwakes2')$$,
  'a member of the circle opens the plan link'
);

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  public.soft_quorum(7),
  'and the quorum follows the audience it just joined'
);

-- Somebody who joins the circle another way is not one of the people this plan
-- is asking (spec §9), so the number of people who have to make it does not
-- move for them. Counting the roster instead would put the quorum above the
-- people who could answer (review round 2).
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '17000000-0000-0000-0000-000000000003'::uuid, 'Tom' from alone;

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  public.soft_quorum(7),
  'a circle join that never opened the plan leaves its quorum where it was'
);

-- Removals leave the number where it is (ADR 0026), and the next join must not
-- quietly undo that: recomputing from a shrunken audience would lower a quorum
-- nobody asked to lower, and could make the plan ready on the way (review
-- round 4).
select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from alone)
  and user_id in (
    '17000000-0000-0000-0000-000000000007',
    '17000000-0000-0000-0000-000000000008',
    '17000000-0000-0000-0000-000000000009'
  );

select pg_temp.act_as_service();
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnwakes2', 'Ren')$$,
  'somebody joins after three people were removed'
);

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  public.soft_quorum(7),
  'the quorum stays where the circle left it: a join never lowers it'
);

select pg_temp.act_as_postgres();
update public.circle_members set status = 'active'
where circle_id = (select circle_id from alone);

select pg_temp.act_as_service();

-- The organiser's own number stops the rule dead.
select pg_temp.act_as_postgres();
update public.plans set quorum = 2, quorum_source = 'chosen'
where id = pg_temp.walkies_plan();

select pg_temp.act_as_service();
select lives_ok(
  $$select public.join_from_plan('17000000-0000-0000-0000-000000000005', 'pnwakes2', 'Ren')$$,
  'a fifth joins after the organiser set the number'
);

select is(
  (select quorum from public.plans p where p.id = pg_temp.walkies_plan()),
  2,
  'a chosen quorum never moves by itself'
);

select * from finish();
rollback;
