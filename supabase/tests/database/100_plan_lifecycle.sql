-- The plan lifecycle's way in: the invite a circle is filled through, the plan
-- itself, and the three things an organiser can do to one afterwards.
--
-- Asserted as client roles with JWTs, because every one of these functions asks
-- `auth.uid()` who is calling and refuses on the answer. Run as postgres they
-- would all say yes.

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

create or replace function pg_temp.act_as_nobody()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
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

-- Sunday Crew again: Maya owns it, Priya and Tom are guests, Sam has a saved
-- place and is a member but not the organiser.
select pg_temp.make_user('10000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('10000000-0000-0000-0000-000000000002', 'Priya', true);
select pg_temp.make_user('10000000-0000-0000-0000-000000000003', 'Tom', true);
select pg_temp.make_user('10000000-0000-0000-0000-000000000004', 'Sam');

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id from public.create_circle('Sunday Crew', '#336699', 'Australia/Melbourne', 'sus31');

select pg_temp.act_as_postgres();
create or replace function pg_temp.circle_id() returns uuid
language sql security definer as $$ select circle_id from fixture $$;

create or replace function pg_temp.digest_of(secret text) returns bytea
language sql as $$ select extensions.digest(secret, 'sha256') $$;

create or replace function pg_temp.live_invites(p_circle uuid) returns integer
language sql security definer as $$
  select count(*)::integer from public.circle_invites i
  where i.circle_id = p_circle and i.revoked_at is null;
$$;

-- ---------------------------------------------------------------------------
-- issue_invite
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.issue_invite(pg_temp.circle_id(), pg_temp.digest_of('sam-tries')) $$,
  'not_the_owner',
  'handing out the way in is the owner''s alone (spec §5.2)'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.issue_invite(pg_temp.circle_id(), pg_temp.digest_of('first-link')) $$,
  'the owner issues the circle''s link'
);

select is(pg_temp.live_invites(pg_temp.circle_id()), 1, 'one live invite');

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'circles.invite_rotated' and o.aggregate_id = pg_temp.circle_id()),
  0,
  'and nothing announced: a circle''s first link is part of the circle, not a rotation'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.issue_invite(pg_temp.circle_id(), pg_temp.digest_of('second-link')) $$,
  'resetting the link is the same call'
);

select is(
  pg_temp.live_invites(pg_temp.circle_id()),
  1,
  'still one live invite — a reset that left two would invalidate nothing'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'circles.invite_rotated' and o.aggregate_id = pg_temp.circle_id()),
  1,
  'and *that* is announced: the link somebody was given has stopped working'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('first-link'), 'Priya') $$,
  'invite_inactive',
  'the first link no longer opens anything'
);

select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('second-link'), 'Priya') $$,
  'and the current one does'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('second-link'), 'Tom') $$,
  'for everybody'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('second-link'), 'Sam') $$,
  'including a saved-place member'
);

-- ---------------------------------------------------------------------------
-- create_plan
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.create_plan(pg_temp.circle_id(), 'Sneaky', 'catch_up',
       date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
       timestamptz '2099-09-16T10:00:00Z') $$,
  'needs_permanent_identity',
  'a guest cannot start a plan (ADR 0004) — the state machine''s guard, not a second check'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plans p where p.circle_id = pg_temp.circle_id()),
  0,
  'and nothing is left behind: the insert rolls back with the transition that refused it'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
create temporary table made as
select * from public.create_plan(pg_temp.circle_id(), 'Catch up', 'catch_up',
  date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
  timestamptz '2099-09-16T10:00:00Z');

select pg_temp.act_as_postgres();
create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select id from made $$;

select is((select state from made), 'collecting', 'a new plan is collecting, not draft');
select is((select revision from made), 1, 'at revision one');
select is((select organiser_user_id from made), '10000000-0000-0000-0000-000000000001'::uuid,
  'organised by whoever made it');
select is((select time_zone from made), 'Australia/Melbourne', 'in the circle''s zone, not the caller''s');
select matches((select short_code from made), '^[a-hjkmnp-z2-9]{6,12}$',
  'with a short code a person can read out — no o, l, i, 0 or 1');

select is(
  (select count(*)::integer from public.plan_participants pp where pp.plan_id = pg_temp.plan_id()),
  4,
  'addressed to every active member, which is a fact recorded rather than derived'
);

select is(
  (select array_agg(user_id) from public.plan_required_members rm where rm.plan_id = pg_temp.plan_id()),
  array['10000000-0000-0000-0000-000000000001'::uuid],
  'and the organiser is required by default (spec §5.3)'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.aggregate_id = pg_temp.plan_id() and o.event_name = 'planning.plan_created'),
  1,
  'announced once, by the transition rather than by the function'
);

-- An explicit list replaces the default rather than adding to it.
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
create temporary table required_plan as
select * from public.create_plan(pg_temp.circle_id(), 'Dinner', 'dinner',
  date '2099-10-01', date '2099-10-05', 1050, 1350, 120, 2,
  timestamptz '2099-09-30T10:00:00Z',
  array['10000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000003'::uuid]);

select pg_temp.act_as_postgres();
select bag_eq(
  format($$ select user_id from public.plan_required_members where plan_id = %L $$,
         (select id from required_plan)),
  $$ values ('10000000-0000-0000-0000-000000000002'::uuid),
            ('10000000-0000-0000-0000-000000000003'::uuid) $$,
  'an explicit list is the list — an organiser who names three has said something about themselves too'
);

-- An empty array is a different answer from no answer.
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
create temporary table nobody_plan as
select * from public.create_plan(pg_temp.circle_id(), 'Coffee', 'coffee',
  date '2099-11-01', date '2099-11-05', 1050, 1350, 120, 2,
  timestamptz '2099-10-30T10:00:00Z', array[]::uuid[]);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plan_required_members
   where plan_id = (select id from nobody_plan)),
  0,
  'an empty list means nobody is required, which is not the same as saying nothing'
);

-- A name that is not in the circle cannot be required into it.
select pg_temp.make_user('10000000-0000-0000-0000-00000000000f', 'An Outsider');
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
create temporary table outsider_plan as
select * from public.create_plan(pg_temp.circle_id(), 'Drinks', 'drinks',
  date '2099-12-01', date '2099-12-05', 1050, 1350, 120, 2,
  timestamptz '2099-11-30T10:00:00Z',
  array['10000000-0000-0000-0000-00000000000f'::uuid]);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plan_required_members
   where plan_id = (select id from outsider_plan)),
  0,
  'somebody outside the circle is not required into it'
);

-- An archived circle stops all prompts (spec §5.2), and a new plan is the loudest.
update public.circles set status = 'archived' where id = pg_temp.circle_id();
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.create_plan(pg_temp.circle_id(), 'Too late', 'catch_up',
       date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
       timestamptz '2099-09-16T10:00:00Z') $$,
  'circle_archived',
  'an archived circle takes no new plans'
);
select pg_temp.act_as_postgres();
update public.circles set status = 'active' where id = pg_temp.circle_id();

-- ---------------------------------------------------------------------------
-- reask_audience — the question a client cannot ask itself
-- ---------------------------------------------------------------------------
insert into public.plan_responses (plan_id, revision, user_id, status)
values (pg_temp.plan_id(), 1, '10000000-0000-0000-0000-000000000002', 'flexible');

select pg_temp.act_as('10000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.reask_audience(pg_temp.plan_id()) $$,
  'not_the_organiser',
  'a member cannot see who has answered — a preview of an edit they cannot make is a roster'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::integer from public.reask_audience(pg_temp.plan_id())),
  4,
  'the organiser sees everyone the plan was addressed to'
);

select bag_eq(
  format($$ select member_user_id from public.reask_audience(%L) where has_responded $$,
         pg_temp.plan_id()),
  $$ values ('10000000-0000-0000-0000-000000000002'::uuid) $$,
  'and which of them have answered — that they did, never what they said'
);

-- ---------------------------------------------------------------------------
-- revise_plan: the difference between changing the question and changing what
-- happens to the answers (spec §5.3)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.revise_plan(pg_temp.plan_id(), false, '{"quorum": 3}'::jsonb) $$,
  'not_the_organiser',
  'only the organiser edits'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select revision from public.revise_plan(pg_temp.plan_id(), false, '{"quorum": 3}'::jsonb)),
  1,
  'a quorum change starts no revision'
);

select is(
  (select quorum from public.plans where id = pg_temp.plan_id()),
  3,
  'but does change the quorum'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plan_responses r
   join public.plans p on p.id = r.plan_id and p.revision = r.revision
   where p.id = pg_temp.plan_id()),
  1,
  'and costs nobody a second reply — the answer given is still the answer'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select revision from public.revise_plan(
     pg_temp.plan_id(), false, '{"response_deadline": "2099-09-15T10:00:00Z"}'::jsonb)),
  1,
  'nor does moving the deadline'
);

select is(
  (select revision from public.revise_plan(
     pg_temp.plan_id(), false, '{"window_end": "2099-09-19"}'::jsonb)),
  2,
  'changing the window does: it is a different question'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plan_responses r
   join public.plans p on p.id = r.plan_id and p.revision = r.revision
   where p.id = pg_temp.plan_id()),
  0,
  'and the answers belong to the revision that was asked, so they are no longer current'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.aggregate_id = pg_temp.plan_id() and o.event_name = 'planning.plan_revised'),
  3,
  'each of the three said "the plan changed"; the revision is what says whether it cost anything'
);

-- Changing both at once is an edit, and costs what an edit costs. The quorum
-- riding along does not make it cheap — which is the point of deriving the
-- action from the payload rather than letting a caller name it. A caller cannot
-- ask for `adjust` at all, and could not get far if it could:
-- `allowed_keys('adjust')` is the two keys alone.
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select revision from public.revise_plan(pg_temp.plan_id(), false,
     '{"quorum": 4, "window_end": "2099-09-18"}'::jsonb)),
  3,
  'a quorum change alongside a window change is an edit, and starts a revision'
);

select pg_temp.act_as_postgres();
select is(
  (select array_agg(k order by k) from unnest(planning.allowed_keys('adjust')) as k),
  array['quorum', 'response_deadline'],
  'because an adjustment may say nothing else at all'
);

-- ---------------------------------------------------------------------------
-- cancel_plan
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.cancel_plan(pg_temp.plan_id()) $$,
  'not_the_organiser',
  'only the organiser cancels'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select state from public.cancel_plan(pg_temp.plan_id(), 'Something came up')),
  'cancelled',
  'the organiser calls it off'
);

select is(
  (select cancel_note from public.plans where id = pg_temp.plan_id()),
  'Something came up',
  'with the note on the row, where the notification pipeline reads it'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.aggregate_id = pg_temp.plan_id() and o.event_name = 'planning.plan_cancelled'),
  1,
  'withdrawing an ask says so'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.aggregate_id = pg_temp.plan_id() and o.payload::text like '%Something came up%'),
  0,
  'and the note is not in the event: an outbox payload may not carry somebody''s words'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.cancel_plan(pg_temp.plan_id()) $$,
  'plan_is_finished',
  'a plan already called off cannot be called off again'
);

-- ---------------------------------------------------------------------------
-- Round 1: a revision is a new question asked of the same people.
--
-- Nothing carried the audience across, so an edited plan arrived at revision 2
-- addressed to nobody — `replace_response` refuses a member who is not a
-- participant of the current revision, so no one could answer it at all. The gap
-- was unreachable until this ticket gave anyone a way to edit a plan.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
create temporary table edited as
select * from public.create_plan(pg_temp.circle_id(), 'Carried', 'catch_up',
  date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
  timestamptz '2099-09-16T10:00:00Z');

select pg_temp.act_as_postgres();
create or replace function pg_temp.edited_id() returns uuid
language sql security definer as $$ select id from edited $$;

select is(
  (select count(*)::integer from public.plan_participants
   where plan_id = pg_temp.edited_id() and revision = 1),
  4,
  'revision one is addressed to the circle'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select revision from public.revise_plan(
     pg_temp.edited_id(), false, '{"window_end": "2099-09-19"}'::jsonb)),
  2,
  'an edit starts a revision'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plan_participants
   where plan_id = pg_temp.edited_id() and revision = 2),
  4,
  'and the same people are asked again — a plan addressed to nobody can be answered by nobody'
);

select is(
  (select array_agg(user_id) from public.plan_required_members
   where plan_id = pg_temp.edited_id() and revision = 2),
  array['10000000-0000-0000-0000-000000000001'::uuid],
  'with whoever had to be there still having to be'
);

-- Carried, not recomputed from the roster: joining an active plan is an opt-in
-- (spec §9), so somebody who joined the circle after it was created is not added
-- to it by the organiser fixing a date.
select pg_temp.make_user('10000000-0000-0000-0000-00000000001a', 'Late Arrival', true);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '10000000-0000-0000-0000-00000000001a', 'Nic');

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select revision from public.revise_plan(
     pg_temp.edited_id(), false, '{"window_end": "2099-09-18"}'::jsonb)),
  3,
  'another edit, another revision'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plan_participants
   where plan_id = pg_temp.edited_id() and revision = 3),
  4,
  'and the member who joined afterwards is still not on it: opting in is theirs to do'
);

-- ---------------------------------------------------------------------------
-- Round 1: a quorum change makes the stored candidates wrong.
--
-- `candidate_is_eligible` checks the set's versions and the near-miss flag and
-- never reads the plan's quorum — so raising it from four to five left a
-- four-person candidate confirmable.
-- ---------------------------------------------------------------------------
insert into public.candidate_sets (plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count)
select pg_temp.edited_id(), p.revision, p.input_version, p.scoring_version, repeat('a', 64), 10, 1, 1, 4
from public.plans p where p.id = pg_temp.edited_id();

select is(
  (select count(*)::integer from public.candidate_sets cs
   join public.plans p on p.id = cs.plan_id
   where cs.plan_id = pg_temp.edited_id()
     and cs.input_version = p.input_version),
  1,
  'the set is current for the plan as it stands'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select revision from public.revise_plan(pg_temp.edited_id(), false, '{"quorum": 3}'::jsonb)),
  3,
  'raising the quorum starts no revision'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.candidate_sets cs
   join public.plans p on p.id = cs.plan_id
   where cs.plan_id = pg_temp.edited_id()
     and cs.input_version = p.input_version),
  0,
  'but does stale the candidate set, because which times are eligible depends on it'
);

-- ---------------------------------------------------------------------------
-- Round 1: required members can be changed, which spec §9 requires and nothing
-- could do.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select lives_ok(
  format($$ select public.revise_plan(%L, false, '{}'::jsonb,
       array['10000000-0000-0000-0000-000000000002'::uuid]) $$, pg_temp.edited_id()),
  'the organiser changes who has to be there'
);

select pg_temp.act_as_postgres();
select is(
  (select array_agg(user_id) from public.plan_required_members
   where plan_id = pg_temp.edited_id()
     and revision = (select revision from public.plans where id = pg_temp.edited_id())),
  array['10000000-0000-0000-0000-000000000002'::uuid],
  'and the list is the list, not an addition to it'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select lives_ok(
  format($$ select public.revise_plan(%L, false, '{}'::jsonb, array[]::uuid[]) $$,
         pg_temp.edited_id()),
  'an empty list is allowed'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.plan_required_members
   where plan_id = pg_temp.edited_id()
     and revision = (select revision from public.plans where id = pg_temp.edited_id())),
  0,
  'and means nobody is required, which is how an ineligible plan is unstuck (spec §9)'
);

-- ---------------------------------------------------------------------------
-- Round 1: a removed organiser is not an organiser.
-- ---------------------------------------------------------------------------
select pg_temp.make_user('10000000-0000-0000-0000-00000000002a', 'Departed');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '10000000-0000-0000-0000-00000000002a', 'Departed');

select pg_temp.act_as('10000000-0000-0000-0000-00000000002a');
create temporary table their_plan as
select * from public.create_plan(pg_temp.circle_id(), 'Theirs', 'catch_up',
  date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
  timestamptz '2099-09-16T10:00:00Z');

select pg_temp.act_as_postgres();
update public.circle_members m set status = 'removed'
where m.circle_id = pg_temp.circle_id() and m.user_id = '10000000-0000-0000-0000-00000000002a';

select pg_temp.act_as('10000000-0000-0000-0000-00000000002a');
select throws_ok(
  format($$ select public.reask_audience(%L) $$, (select id from their_plan)),
  'not_the_organiser',
  'a removed organiser cannot read the roster: an id on a row is not membership'
);

-- ---------------------------------------------------------------------------
-- Who may call what (§14)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_nobody();

select throws_ok(
  $$ select public.create_plan('00000000-0000-0000-0000-000000000000'::uuid, 't', 'catch_up',
       date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2, now()) $$,
  '42501',
  'permission denied for function create_plan',
  'anon cannot create a plan'
);

select throws_ok(
  $$ select public.issue_invite('00000000-0000-0000-0000-000000000000'::uuid, '\x00'::bytea) $$,
  '42501',
  'permission denied for function issue_invite',
  'nor issue an invite'
);

select pg_temp.act_as_postgres();

select ok(
  not has_function_privilege('anon', 'public.revise_plan(uuid, boolean, jsonb, uuid[])', 'execute'),
  'nor revise a plan'
);

select ok(
  not has_function_privilege('authenticated', 'planning.transition_plan(uuid, text, uuid, jsonb)', 'execute'),
  'and no client role reaches the state machine directly — the wrappers are the only way in'
);

select ok(
  has_function_privilege('authenticated', 'public.cancel_plan(uuid, text)', 'execute'),
  'while an authenticated caller can cancel, and is refused by the guard rather than by the grant'
);

-- Deferred constraints are checked at commit, and this suite rolls back — so a
-- violation of one would be invisible without this. S1-13 lost ten review rounds
-- to that.
set constraints all immediate;

select * from finish();
rollback;
