-- Locking a time in, from the outside.
--
-- `planning.transition_plan` already writes the confirmation, derives the
-- attendance and emits the event, and 030 and 060 test all of that. What is
-- tested here is the one thing `public.confirm_meetup` adds, which is a
-- distinction rather than a behaviour: `planning.candidate_is_eligible` answers
-- a single boolean for four different situations, and the organiser needs to
-- know which. "Your screen is out of date, look again" and "that is not one of
-- the options" are different sentences, and only one of them is true at a time.

begin;
select plan(24);

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

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Maya organises; Priya and Tom are in the circle and on the plan.
select pg_temp.make_user('00000000-0000-0000-0000-0000000007a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000007a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000007a3', 'Tom');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-confirm-fn');

select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id from public.circles where creation_key = 'key-confirm-fn';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000007a2'::uuid, 'Priya' from t
union all
select circle_id, '00000000-0000-0000-0000-0000000007a3'::uuid, 'Tom' from t;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000007a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pncfmt'
from t;

create temporary table tp as select id as plan_id from public.plans where short_code = 'pncfmt';
grant select on tp to anon, authenticated, service_role;
create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select plan_id from tp $$;

insert into public.plan_participants (plan_id, revision, user_id)
select plan_id, 1, u from tp, unnest(array[
  '00000000-0000-0000-0000-0000000007a1'::uuid,
  '00000000-0000-0000-0000-0000000007a2'::uuid,
  '00000000-0000-0000-0000-0000000007a3'::uuid
]) as u;

-- Priya and Tom answered, so there is something for the candidate to be made of.
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a2');
select public.replace_response(pg_temp.plan_id(), 1, 'flexible');
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a3');
select public.replace_response(pg_temp.plan_id(), 1, 'flexible');

-- A set for the plan as it stands, with one eligible option on the Thursday.
select pg_temp.act_as_postgres();
create or replace function pg_temp.make_set() returns uuid
language plpgsql security definer as $$
declare
  set_id uuid;
begin
  delete from public.candidate_sets cs where cs.plan_id = pg_temp.plan_id();

  insert into public.candidate_sets (
    plan_id, revision, input_version, scoring_version, input_hash,
    starts_considered, eligible_count, responded_count, active_member_count
  )
  select p.id, p.revision, p.input_version, p.scoring_version, 'seed', 40, 1, 2, 3
  from public.plans p where p.id = pg_temp.plan_id()
  returning id into set_id;

  insert into public.candidates (
    candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
    explicit_count, flexible_count, explanation_code, explanation_count
  )
  values (set_id, false, 1,
    timestamptz '2099-09-17T08:30:00Z', timestamptz '2099-09-17T10:30:00Z',
    array['00000000-0000-0000-0000-0000000007a2'::uuid,
          '00000000-0000-0000-0000-0000000007a3'::uuid],
    0, 2, 'best_attendance', 2);

  return set_id;
end;
$$;

select pg_temp.make_set();
select planning.transition_plan(pg_temp.plan_id(), 'candidates_ready',
  '00000000-0000-0000-0000-0000000007a1');

-- What the organiser's screen would have been showing: the set the options were
-- rendered from, whose id they send back when they tap.
create or replace function pg_temp.set_id() returns uuid
language sql security definer as $$
  select cs.id from public.candidate_sets cs
  join public.plans p on p.id = cs.plan_id
  where cs.plan_id = pg_temp.plan_id()
    and cs.revision = p.revision
    and cs.input_version = p.input_version
    and cs.scoring_version = p.scoring_version
$$;

-- ---------------------------------------------------------------------------
-- Who may call it
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.confirm_meetup(uuid, text, uuid, text, text, text, text)', 'execute'),
  'a signed-in caller can try to confirm — whether they may is the machine''s answer, not the grant''s'
);
select ok(
  not has_function_privilege('anon', 'public.confirm_meetup(uuid, text, uuid, text, text, text, text)', 'execute'),
  'and nobody who is not signed in can'
);

-- ---------------------------------------------------------------------------
-- Whose it is
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a2');
select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-17T08:30:00+00:00', pg_temp.set_id(), 'none') $$, pg_temp.plan_id()),
  'not_the_organiser',
  'a member cannot lock in a time: only the organiser confirms (spec §5.6)'
);

-- ---------------------------------------------------------------------------
-- Round 1: the set the organiser was *looking at*
--
-- An answer landing while the review screen is open recalculates inline
-- (ADR 0018), so there is a new current set by the time the tap arrives. If the
-- chosen time is still eligible in it, confirming without saying which version
-- was on the screen freezes an availability list nobody saw.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-17T08:30:00+00:00', '00000000-0000-0000-0000-0000000000aa'::uuid, 'none') $$, pg_temp.plan_id()),
  'stale_candidates',
  'a set the plan has moved past is refused, even with a current set and an eligible time'
);

select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-17T08:30:00+00:00', pg_temp.set_id(), null) $$, pg_temp.plan_id()),
  'chased_answer_required',
  'and the survey is required by the function as well as by the schema: this is callable directly'
);

-- ---------------------------------------------------------------------------
-- A stale screen, in each of the three ways a set is replaced
--
-- The organiser holds the id of the set they were shown. What changes under
-- them is which set is *current* — and the three ways that happens are a new
-- revision, an answer moving the input version, and the engine's scoring
-- version changing, which moves nothing the client can see and is the reason
-- the token is an id rather than a pair of numbers.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select pg_temp.set_id() as shown_set \gset
update public.plans set input_version = input_version + 1 where id = pg_temp.plan_id();
select pg_temp.make_set();
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-17T08:30:00+00:00', %L::uuid, 'none') $$,
    pg_temp.plan_id(), :'shown_set'),
  'stale_candidates',
  'somebody answered while the review screen was open, so the times on it are not the times on offer'
);

select pg_temp.act_as_postgres();
select pg_temp.set_id() as before_engine \gset
update public.plans set scoring_version = scoring_version + 1 where id = pg_temp.plan_id();
select pg_temp.make_set();
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-17T08:30:00+00:00', %L::uuid, 'none') $$,
    pg_temp.plan_id(), :'before_engine'),
  'stale_candidates',
  'and a set the engine replaced is stale too, though no version the client can see has moved'
);

select pg_temp.act_as_postgres();
update public.plans set scoring_version = scoring_version - 1 where id = pg_temp.plan_id();
select pg_temp.make_set();

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-17T08:30:00+00:00', null, 'none') $$,
    pg_temp.plan_id()),
  'stale_candidates',
  'and naming no set at all is not a way past the check — `null is distinct from null` is false'
);
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- A current set, and a time that is not in it
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-19T08:30:00+00:00', pg_temp.set_id(), 'none') $$, pg_temp.plan_id()),
  'needs_candidate',
  'with the set current, an id that is not in it means that time is not on offer — a different sentence'
);

select throws_ok(
  format($$ select public.confirm_meetup(%L, 'not-a-time', pg_temp.set_id(), 'none') $$, pg_temp.plan_id()),
  'needs_candidate',
  'and anything that is not an instant is not a candidate, rather than an error about parsing'
);

-- ---------------------------------------------------------------------------
-- Locking it in
-- ---------------------------------------------------------------------------
select is(
  (select (public.confirm_meetup(
     pg_temp.plan_id(), '2099-09-17T08:30:00+00:00', pg_temp.set_id(), 'one',
     'Hope St Radio', 'https://maps.example/hope-st', 'Upstairs')).status),
  'active',
  'the organiser locks it in'
);

select pg_temp.act_as_postgres();
select is(
  (select state from public.plans where id = pg_temp.plan_id()),
  'confirmed',
  'and the plan is confirmed'
);

select is(
  (select array[c.place_name, c.note, c.chased_answer]
   from public.meetup_confirmations c where c.plan_id = pg_temp.plan_id()),
  array['Hope St Radio', 'Upstairs', 'one'],
  'with the place, the note and the answer to "did you have to chase anyone?" (spec §5.10)'
);

select is(
  (select c.available_user_ids from public.meetup_confirmations c
   where c.plan_id = pg_temp.plan_id()),
  array['00000000-0000-0000-0000-0000000007a2'::uuid,
        '00000000-0000-0000-0000-0000000007a3'::uuid],
  'and who could make it frozen as it was, which a later reply does not change'
);

select is(
  (select count(*)::integer from public.attendance a
   join public.meetup_confirmations c on c.id = a.confirmation_id
   where c.plan_id = pg_temp.plan_id()),
  3,
  'everybody who was asked has an attendance row, derived rather than said'
);

select is(
  (select a.status from public.attendance a
   join public.meetup_confirmations c on c.id = a.confirmation_id
   where c.plan_id = pg_temp.plan_id() and a.user_id = '00000000-0000-0000-0000-0000000007a1'),
  'unknown',
  'including the organiser, who has not answered and is not counted as going'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.aggregate_id = pg_temp.plan_id() and o.event_name = 'confirmation.meetup_confirmed'),
  1,
  'announced once, by the transition'
);

-- ---------------------------------------------------------------------------
-- And not twice
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select throws_ok(
  format($$ select public.confirm_meetup(%L, '2099-09-17T08:30:00+00:00', pg_temp.set_id(), 'none') $$, pg_temp.plan_id()),
  'wrong_state',
  'a confirmed plan cannot be confirmed again: there is one active confirmation per revision'
);

select throws_ok(
  $$ select public.confirm_meetup('00000000-0000-0000-0000-0000000000ff'::uuid,
       '2099-09-17T08:30:00+00:00', '00000000-0000-0000-0000-0000000000aa'::uuid, 'none') $$,
  'plan_not_found',
  'and a plan that is not there says so by name'
);

-- ---------------------------------------------------------------------------
-- Round 1: counting what a member may not count for themselves
--
-- `attendance_select_member` shows a retrospective answer only to the person
-- who gave it — "nobody is scored and nobody is told who came" (spec §5.10) —
-- so the organiser, the one person who needs to know whether their report was
-- corroborated, is exactly the person who cannot see the rows that would do it.
-- Counted by a definer function instead, which returns no identity at all.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
create or replace function pg_temp.confirmation_id() returns uuid
language sql security definer as $$
  select id from public.meetup_confirmations where plan_id = pg_temp.plan_id()
$$;

-- The meetup has to be over before anybody can say they were there.
update public.meetup_confirmations
set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
where plan_id = pg_temp.plan_id();

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a2');
update public.attendance set status = 'was_there'
where confirmation_id = pg_temp.confirmation_id()
  and user_id = '00000000-0000-0000-0000-0000000007a2';

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select is(
  (select public.confirmation_evidence(pg_temp.confirmation_id()) ->> 'was_there'),
  '1',
  'the organiser learns that one person said they were there'
);

select is(
  (select public.confirmation_evidence(pg_temp.confirmation_id()) ->> 'someone_else_was_there'),
  'false',
  'and that nobody has corroborated anything, because nobody has reported anything yet'
);

select lives_ok(
  format($$ select public.report_outcome(%L, 'happened') $$, pg_temp.confirmation_id()),
  'the organiser says it happened'
);

select is(
  (select public.confirmation_evidence(pg_temp.confirmation_id()) ->> 'someone_else_was_there'),
  'true',
  'and now somebody other than the reporter has said they were there: corroborated (§11.1)'
);

-- And this is why it takes a function at all. The same count, asked by the
-- organiser through their own session, is zero: the policy shows a
-- retrospective answer only to the person who gave it, so the one person who
-- needs to know whether they were corroborated is the one person who cannot see
-- it. An endpoint counting these rows through the caller's client would have
-- reported "nobody" for ever, and the north-star metric's second number would
-- have been a flat zero nobody noticed was zero.
select is(
  (select count(*)::integer from public.attendance a
   where a.confirmation_id = pg_temp.confirmation_id() and a.status = 'was_there'),
  0,
  'while the organiser''s own session sees none of those rows at all'
);

select * from finish();
rollback;
