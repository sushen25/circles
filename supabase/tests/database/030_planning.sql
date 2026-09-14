-- Planning, from the outside.
--
-- Numbered 030 because 020 is the outbox tripwire, which stays until S1-11
-- lands the table both `create_circle` and `transition_plan` owe events to.
--
-- The claim under test is architecture §8.3's: "nothing else writes
-- `plans.state`". A comment cannot make that true and a convention cannot
-- either, so most of this file is about trying to write it some other way.

begin;
select plan(79);

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
    id::text || '@example.com',
    anonymous,
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

select pg_temp.make_user('00000000-0000-0000-0000-0000000001a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000001a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000001a3', 'Outsider');
select pg_temp.make_user('00000000-0000-0000-0000-0000000001a9', 'Guest', true);

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-planning');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-planning';
grant select on t to anon, authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000001a2', 'Priya' from t;

/* A plan in `collecting`, owned by Maya. Inserted directly, because creating one
   is `create-plan`'s job (S1-15) and this ticket is the tables underneath it. */
create or replace function pg_temp.make_plan(
  code text,
  state text default 'collecting',
  mode text default 'named',
  organiser uuid default '00000000-0000-0000-0000-0000000001a1'
)
returns uuid
language plpgsql
as $$
declare
  new_id uuid;
begin
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code,
    quiet_threshold
  )
  values (
    (select circle_id from t), mode, state, organiser, 'Catch up', 'Australia/Melbourne',
    date '2026-09-14', date '2026-09-20', 17 * 60 + 30, 22 * 60 + 30,
    120, 4, timestamptz '2026-09-20T10:00:00Z', code,
    case when mode = 'quiet' then 3 else null end
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The shape.
-- ---------------------------------------------------------------------------

select has_schema('planning', 'the planning schema exists');
select has_table('public', 'plans', 'plans exists');
select has_table('public', 'plan_participants', 'plan_participants exists');
select has_table('public', 'plan_required_members', 'plan_required_members exists');
select has_table('private', 'plan_initiators', 'private.plan_initiators exists');
select has_table('private', 'plan_interest', 'private.plan_interest exists');
select has_view('public', 'plan_interest_counts', 'plan_interest_counts exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.plans'::regclass),
  'RLS is on for plans'
);
select ok(
  not has_schema_privilege('authenticated', 'planning', 'usage'),
  'no client role can even look inside the planning schema'
);
select ok(
  not has_function_privilege(
    'authenticated', 'planning.transition_plan(uuid,text,uuid,jsonb)', 'execute'
  ),
  'and none can call transition_plan directly'
);

-- The documented caller has to be able to call it. A function nothing can reach
-- is not a safe function, it is a broken one.
select ok(
  has_schema_privilege('service_role', 'planning', 'usage'),
  'the service role can reach the planning schema'
);
select ok(
  has_function_privilege(
    'service_role', 'planning.transition_plan(uuid,text,uuid,jsonb)', 'execute'
  ),
  'and call transition_plan — this is the Edge Functions'' path (§9.1)'
);

-- …and cannot go around it. The marker the trigger reads is a custom GUC, which
-- any caller able to update the table could have set first; the privilege is
-- what the caller cannot manufacture.
select ok(
  not has_column_privilege('service_role', 'public.plans', 'state', 'update'),
  'the service role cannot write plans.state at all, marker or no marker'
);

-- ---------------------------------------------------------------------------
-- The transition table is the domain's, not a retyping of it.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from planning.transitions),
  21,
  'twenty-one transitions, seeded from the generated block'
);

-- Two of them are `adjust`, and the point of it is the column it does *not*
-- set. Changing the quorum or the deadline "changes what happens to the answers,
-- not the question" (spec §5.3), so it must not start a revision — responses are
-- keyed by revision, and bumping one silently asks the whole circle again.
select is(
  (select array_agg(from_state order by from_state) from planning.transitions
   where action = 'adjust' and not bumps_revision),
  array['collecting', 'ready'],
  'a quorum or deadline change adjusts the plan without starting a revision'
);

select is(
  (select array_agg(from_state order by from_state) from planning.transitions
   where action = 'edit' and bumps_revision),
  array['collecting', 'ready'],
  'while an edit — the window, the band, the duration — does'
);
select is(
  (select guards from planning.transitions where from_state = 'ready' and action = 'confirm'),
  array['organiser', 'candidate'],
  'confirm carries both of its guards — a pair of booleans would have dropped one'
);
select ok(
  (select bumps_revision from planning.transitions where from_state = 'confirmed' and action = 'reopen'),
  'reopen bumps the revision'
);
select ok(
  not exists (select 1 from planning.transitions where from_state in ('completed', 'expired', 'cancelled')),
  'nothing moves out of a terminal state'
);

-- ---------------------------------------------------------------------------
-- Nothing else writes `state`.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnaaaa') as plan_a \gset

select throws_ok(
  format($$update public.plans set state = 'confirmed' where id = '%s'$$, :'plan_a'),
  '42501',
  null,
  'not even postgres can write state directly'
);
select lives_ok(
  format($$update public.plans set title = 'Dinner' where id = '%s'$$, :'plan_a'),
  'but every other column is an ordinary update'
);

select is(
  (select state from planning.transition_plan(:'plan_a', 'candidates_ready',
    '00000000-0000-0000-0000-0000000001a1')),
  'ready',
  'transition_plan moves it'
);
select is(
  (select state from public.plans where id = :'plan_a'),
  'ready',
  'and the row really changed'
);
select is(
  current_setting('circles.in_transition', true),
  'off',
  'the guard closes behind it, so a later update in the same transaction is still refused'
);
select throws_ok(
  format($$update public.plans set state = 'completed' where id = '%s'$$, :'plan_a'),
  '42501',
  null,
  'proved: the same transaction cannot write state after a transition'
);

-- ---------------------------------------------------------------------------
-- The guards.
-- ---------------------------------------------------------------------------

select throws_ok(
  format(
    $$select planning.transition_plan('%s', 'confirm', '%s', '{"candidate_id":"x"}'::jsonb)$$,
    :'plan_a', '00000000-0000-0000-0000-0000000001a2'
  ),
  'P0001',
  'not_the_organiser',
  'a member cannot confirm'
);
select throws_ok(
  format($$select planning.transition_plan('%s', 'confirm', '%s')$$,
    :'plan_a', '00000000-0000-0000-0000-0000000001a1'),
  'P0001',
  'needs_candidate',
  'and the organiser cannot confirm without naming a candidate'
);
-- The guard checks eligibility, not presence (tightened in 0004 once
-- `public.candidates` existed), so the id has to name an eligible candidate in
-- the plan's *current* set.
select pg_temp.act_as_postgres();
insert into public.candidate_sets
  (plan_id, revision, input_version, scoring_version, input_hash,
   starts_considered, eligible_count, responded_count, active_member_count)
select id, revision, input_version, scoring_version, 'h', 10, 1, 2, 2
from public.plans where id = :'plan_a';
insert into public.candidates
  (candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
   explicit_count, flexible_count, explanation_code, explanation_count)
select cs.id, false, 1, timestamptz '2026-09-17T08:30:00Z', timestamptz '2026-09-17T10:30:00Z',
  array['00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001a2']::uuid[],
  2, 0, 'best_attendance', 2
from public.candidate_sets cs where cs.plan_id = :'plan_a';

select is(
  (select state from planning.transition_plan(:'plan_a', 'confirm',
    '00000000-0000-0000-0000-0000000001a1', '{"candidate_id":"2026-09-17T08:30:00.000Z"}'::jsonb)),
  'confirmed',
  'with an eligible one from the current set, they can'
);

select throws_ok(
  format($$select planning.transition_plan('%s', 'candidates_ready', '%s')$$,
    :'plan_a', '00000000-0000-0000-0000-0000000001a1'),
  'P0001',
  'wrong_state',
  'an action with no row for this state is refused'
);

select pg_temp.make_plan('pnbbbb', 'cancelled') as plan_done \gset
select throws_ok(
  format($$select planning.transition_plan('%s', 'edit', '%s')$$,
    :'plan_done', '00000000-0000-0000-0000-0000000001a1'),
  'P0001',
  'plan_is_finished',
  'a finished plan says so, rather than "not right now"'
);

-- The organiser gate, ADR 0004, from the server side this time.
select pg_temp.make_plan('pncccc', 'collecting', 'quiet', null) as plan_quiet \gset
insert into private.plan_initiators (plan_id, initiator_user_id)
values (:'plan_quiet', '00000000-0000-0000-0000-0000000001a1');
insert into private.plan_interest (plan_id, user_id, response)
values (:'plan_quiet', '00000000-0000-0000-0000-0000000001a2', 'keen');
select throws_ok(
  format($$select planning.transition_plan('%s', 'accept_organiser', '%s')$$,
    :'plan_quiet', '00000000-0000-0000-0000-0000000001a9'),
  'P0001',
  'not_a_member',
  'somebody outside the circle cannot take the role'
);

select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000001a9', 'Guest' from t;

select throws_ok(
  format($$select planning.transition_plan('%s', 'accept_organiser', '%s')$$,
    :'plan_quiet', '00000000-0000-0000-0000-0000000001a9'),
  'P0001',
  'needs_permanent_identity',
  'and an anonymous member cannot either (ADR 0004)'
);
select is(
  (select organiser_user_id from planning.transition_plan(:'plan_quiet', 'accept_organiser',
    '00000000-0000-0000-0000-0000000001a2')),
  '00000000-0000-0000-0000-0000000001a2'::uuid,
  'a member with a saved place can, and becomes the organiser'
);
select throws_ok(
  format($$select planning.transition_plan('%s', 'accept_organiser', '%s')$$,
    :'plan_quiet', '00000000-0000-0000-0000-0000000001a1'),
  'P0001',
  'already_has_organiser',
  'and nobody takes it twice'
);

-- ---------------------------------------------------------------------------
-- The two guards that read `private`, and could not be checked anywhere else.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnqqqq', 'collecting', 'quiet', null) as plan_keen \gset
insert into private.plan_initiators (plan_id, initiator_user_id)
values (:'plan_keen', '00000000-0000-0000-0000-0000000001a1');
insert into private.plan_interest (plan_id, user_id, response)
values (:'plan_keen', '00000000-0000-0000-0000-0000000001a2', 'not_this_time');

select throws_ok(
  format($$select planning.transition_plan('%s', 'accept_organiser', '%s')$$,
    :'plan_keen', '00000000-0000-0000-0000-0000000001a2'),
  'P0001',
  'not_keen_initiator_or_owner',
  'somebody who said not this time is not offered the job of arranging it'
);

-- The owner fallback (§5.4): "if nobody volunteers before replies close, the
-- circle owner gets a quiet nudge". Maya owns this circle and is also the
-- initiator here, so the case worth testing is an owner who is neither.
select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnssss', 'ready', 'quiet', null) as plan_owner \gset
select is(
  (select organiser_user_id from planning.transition_plan(:'plan_owner', 'accept_organiser',
    '00000000-0000-0000-0000-0000000001a1')),
  '00000000-0000-0000-0000-0000000001a1'::uuid,
  'the owner can take the role with no interest row and no initiator row at all'
);
select is(
  (select organiser_user_id from planning.transition_plan(:'plan_keen', 'accept_organiser',
    '00000000-0000-0000-0000-0000000001a1')),
  '00000000-0000-0000-0000-0000000001a1'::uuid,
  'the initiator can take it, without their identity leaving `private`'
);

-- Withdrawing before threshold. The guard used to be `organiser`, and a seeking
-- plan has no organiser by definition — so the row was in the table and could
-- never fire for anybody.
select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnrrrr', 'seeking', 'quiet', null) as plan_wd \gset
insert into private.plan_initiators (plan_id, initiator_user_id)
values (:'plan_wd', '00000000-0000-0000-0000-0000000001a1');

select throws_ok(
  format($$select planning.transition_plan('%s', 'cancel', '%s')$$,
    :'plan_wd', '00000000-0000-0000-0000-0000000001a2'),
  'P0001',
  'not_the_initiator',
  'another member cannot withdraw somebody else''s quiet ask'
);
-- Being the initiator is not a way back into a circle you have left. The
-- private row outlives the membership; removal revokes access immediately.
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t)
  and user_id = '00000000-0000-0000-0000-0000000001a1';
select throws_ok(
  format($$select planning.transition_plan('%s', 'cancel', '%s')$$,
    :'plan_wd', '00000000-0000-0000-0000-0000000001a1'),
  'P0001',
  'not_a_member',
  'a removed initiator cannot withdraw their own ask'
);
update public.circle_members set status = 'active'
where circle_id = (select circle_id from t)
  and user_id = '00000000-0000-0000-0000-0000000001a1';

select is(
  (select state from planning.transition_plan(:'plan_wd', 'cancel',
    '00000000-0000-0000-0000-0000000001a1')),
  'cancelled',
  'and the initiator can, while they are still in the circle (spec §5.4)'
);

-- A null CHECK result passes in Postgres, which is how a quiet ask with no
-- threshold — one that could never leave `seeking` — used to be storable.
select throws_ok(
  $$insert into public.plans (
      circle_id, mode, state, title, time_zone,
      window_start, window_end, daily_start_local, daily_end_local,
      duration_minutes, quorum, response_deadline, short_code
    )
    select circle_id, 'quiet', 'seeking', 'No threshold', 'Australia/Melbourne',
      date '2026-09-14', date '2026-09-20', 1050, 1350, 120, 4,
      timestamptz '2026-09-20T10:00:00Z', 'pnttttt'
    from t$$,
  '23514',
  null,
  'a quiet plan with no threshold is refused'
);

-- ---------------------------------------------------------------------------
-- Revisions.
-- ---------------------------------------------------------------------------

select pg_temp.make_plan('pndddd') as plan_edit \gset
select pg_temp.act_as_postgres();
update public.plans set input_version = 7 where id = :'plan_edit';

select is(
  (select revision from planning.transition_plan(:'plan_edit', 'edit',
    '00000000-0000-0000-0000-0000000001a1', '{"quorum":3}'::jsonb)),
  2,
  'an edit bumps the revision'
);
select is(
  (select input_version from public.plans where id = :'plan_edit'),
  1,
  'and resets input_version: a new question means the answers start again'
);
select is(
  (select quorum from public.plans where id = :'plan_edit'),
  3,
  'the payload is applied'
);
select is(
  (select title from public.plans where id = :'plan_edit'),
  'Catch up',
  'and what the payload does not mention is left alone'
);

select pg_temp.make_plan('pneeee', 'confirmed') as plan_reopen \gset
select is(
  (select revision from planning.transition_plan(:'plan_reopen', 'reopen',
    '00000000-0000-0000-0000-0000000001a1')),
  2,
  'a reopen bumps it too'
);
select is(
  (select state from public.plans where id = :'plan_reopen'),
  'collecting',
  'back to collecting'
);

-- ---------------------------------------------------------------------------
-- The deadline never runs past the last possible start.
-- ---------------------------------------------------------------------------

select is(
  public.plan_last_possible_start(date '2026-09-20', 22 * 60 + 30, 120, 'Australia/Melbourne'),
  timestamptz '2026-09-20T10:30:00Z',
  'a 2-hour meetup in a band ending 22:30 cannot start after 20:30 Melbourne'
);
select is(
  public.plan_last_possible_start(date '2026-09-20', 1440, 120, 'Australia/Melbourne'),
  timestamptz '2026-09-20T12:00:00Z',
  'and a band running to midnight ends at 22:00 the same evening'
);

select throws_ok(
  $$insert into public.plans (
      circle_id, mode, state, organiser_user_id, title, time_zone,
      window_start, window_end, daily_start_local, daily_end_local,
      duration_minutes, quorum, response_deadline, short_code
    )
    select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000001a1',
      'Late', 'Australia/Melbourne', date '2026-09-14', date '2026-09-20',
      1050, 1350, 120, 4, timestamptz '2026-09-20T23:00:00Z', 'pnffff'
    from t$$,
  '23514',
  null,
  'a deadline after the last possible start is refused'
);

-- And moving the window under a good deadline is the same mistake.
select throws_ok(
  format(
    $$update public.plans set window_end = date '2026-09-15' where id = '%s'$$,
    :'plan_a'
  ),
  '23514',
  null,
  'shortening the window until the deadline no longer fits is refused too'
);

-- ---------------------------------------------------------------------------
-- The quiet ask's two secrets.
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'private.plan_interest', 'select'),
  'no client role can select individual interest answers'
);
select ok(
  not has_table_privilege('anon', 'private.plan_initiators', 'select'),
  'nor read who started a quiet ask'
);
-- Not "no column called initiator" — that was the first version of this test,
-- and it passed while `created_by` sat two columns away holding exactly the
-- fact it was meant to protect. The property is that *no* column of the public
-- row identifies a person other than the organiser, whose name is public by
-- design.
select is(
  (select coalesce(string_agg(column_name, ', ' order by column_name), '')
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'plans'
     and (data_type = 'uuid' or column_name like '%user%' or column_name like '%by%')
     and column_name not in ('id', 'circle_id', 'organiser_user_id')),
  '',
  'no column of a public plan row names anyone but the organiser'
);

select pg_temp.act_as_postgres();
select pg_temp.make_plan('pngggg', 'seeking', 'quiet', null) as plan_seeking \gset
insert into private.plan_interest (plan_id, user_id, response)
values
  (:'plan_seeking', '00000000-0000-0000-0000-0000000001a1', 'keen'),
  (:'plan_seeking', '00000000-0000-0000-0000-0000000001a2', 'keen');

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select is(
  (select count(*)::integer from public.plan_interest_counts where plan_id = :'plan_seeking'),
  0,
  'a seeking plan has no count at all — before threshold, a count that moves names the person who moved it'
);

-- Two keen answers against a threshold of three. The first version of this
-- test transitioned anyway and asserted the count of two — it had encoded the
-- bug: a guardless row that any caller could fire, publishing a below-threshold
-- count the moment somebody did.
select pg_temp.act_as_postgres();
select throws_ok(
  format($$select planning.transition_plan('%s', 'threshold_reached', '%s')$$,
    :'plan_seeking', '00000000-0000-0000-0000-0000000001a1'),
  'P0001',
  'threshold_not_reached',
  'the threshold transition refuses to fire below the threshold'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select is(
  (select count(*)::integer from public.plan_interest_counts where plan_id = :'plan_seeking'),
  0,
  'and so the count stays hidden'
);

select pg_temp.act_as_postgres();
insert into private.plan_interest (plan_id, user_id, response)
values (:'plan_seeking', '00000000-0000-0000-0000-0000000001a3', 'keen');
select planning.transition_plan(:'plan_seeking', 'threshold_reached',
  '00000000-0000-0000-0000-0000000001a1');

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select is(
  (select keen_count from public.plan_interest_counts where plan_id = :'plan_seeking'),
  3,
  'and a count once it has genuinely passed'
);

-- ---------------------------------------------------------------------------
-- The payload can only say what the action is about.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnuuuu', 'ready') as plan_pay \gset
select throws_ok(
  format(
    $$select planning.transition_plan('%s', 'confirm', '%s',
      '{"candidate_id":"x","quorum":2}'::jsonb)$$,
    :'plan_pay', '00000000-0000-0000-0000-0000000001a1'
  ),
  'P0001',
  'unexpected_payload',
  'a confirm cannot smuggle a quorum change past the revision it would need'
);
select is(
  (select quorum from public.plans where id = :'plan_pay'),
  4,
  'and the quorum is untouched — refused, not silently ignored'
);
select throws_ok(
  format($$select planning.transition_plan('%s', 'cancel', '%s', '{"window_end":"2026-09-15"}'::jsonb)$$,
    :'plan_pay', '00000000-0000-0000-0000-0000000001a1'),
  'P0001',
  'unexpected_payload',
  'nor can a cancel move the window'
);
select lives_ok(
  format($$select planning.transition_plan('%s', 'cancel', '%s', '{"cancel_note":"Rain"}'::jsonb)$$,
    :'plan_pay', '00000000-0000-0000-0000-0000000001a1'),
  'while a cancel note is exactly what a cancel carries'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a3');
select is(
  (select count(*)::integer from public.plan_interest_counts),
  0,
  'somebody outside the circle sees no counts'
);

-- An ask that never reached threshold keeps its count, whatever became of it.
-- `state <> 'seeking'` was the first version of this rule, and `expired` and
-- `cancelled` are both reachable straight from `seeking` — so it published a
-- below-threshold count for exactly the two cases where the answer is nobody's
-- business. In a circle of six, "one person was keen" is close to naming them.
select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnkkkk', 'seeking', 'quiet', null) as plan_expired \gset
insert into private.plan_interest (plan_id, user_id, response)
values (:'plan_expired', '00000000-0000-0000-0000-0000000001a1', 'keen');
select planning.transition_plan(:'plan_expired', 'expire', '00000000-0000-0000-0000-0000000001a1');

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select is(
  (select count(*)::integer from public.plan_interest_counts where plan_id = :'plan_expired'),
  0,
  'a quiet ask that expired below threshold still shows no count'
);

select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnmmmm', 'seeking', 'quiet', null) as plan_withdrawn \gset
insert into private.plan_initiators (plan_id, initiator_user_id)
values (:'plan_withdrawn', '00000000-0000-0000-0000-0000000001a1');
insert into private.plan_interest (plan_id, user_id, response)
values (:'plan_withdrawn', '00000000-0000-0000-0000-0000000001a2', 'keen');
select planning.transition_plan(:'plan_withdrawn', 'cancel',
  '00000000-0000-0000-0000-0000000001a1');

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select is(
  (select count(*)::integer from public.plan_interest_counts where plan_id = :'plan_withdrawn'),
  0,
  'and one withdrawn before threshold shows none either'
);

-- ---------------------------------------------------------------------------
-- An organiser who has left the circle is not the organiser.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select pg_temp.make_plan('pnpppp', 'ready',
  'named', '00000000-0000-0000-0000-0000000001a2') as plan_gone \gset
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t)
  and user_id = '00000000-0000-0000-0000-0000000001a2';

-- Removing the organiser did more than revoke them: 0004's removal trigger
-- sends a ready plan back to collecting, because its candidate set may have
-- needed the person who left. So `confirm` here is `wrong_state` before it is
-- anything else, and the organiser guard is exercised by `cancel` below, which
-- exists in both states.
select is(
  (select state from public.plans where id = :'plan_gone'),
  'collecting',
  'removing the organiser sends their ready plan back to collecting'
);
select throws_ok(
  format($$select planning.transition_plan('%s', 'cancel', '%s')$$,
    :'plan_gone', '00000000-0000-0000-0000-0000000001a2'),
  'P0001',
  'not_the_organiser',
  'nor cancel it'
);

update public.circle_members set status = 'active'
where circle_id = (select circle_id from t)
  and user_id = '00000000-0000-0000-0000-0000000001a2';
select is(
  (select state from planning.transition_plan(:'plan_gone', 'cancel',
    '00000000-0000-0000-0000-0000000001a2')),
  'cancelled',
  'and can again once they are back in the circle'
);

-- ---------------------------------------------------------------------------
-- The participant lists: who may read them, and who may not.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
insert into public.plan_participants (plan_id, revision, user_id)
values
  (:'plan_a', 1, '00000000-0000-0000-0000-0000000001a1'),
  (:'plan_a', 1, '00000000-0000-0000-0000-0000000001a2');
insert into public.plan_required_members (plan_id, revision, user_id)
values (:'plan_a', 1, '00000000-0000-0000-0000-0000000001a1');

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select is(
  (select count(*)::integer from public.plan_participants where plan_id = :'plan_a'),
  2,
  'a member reads the participant list of a plan in their circle'
);
select is(
  (select count(*)::integer from public.plan_required_members where plan_id = :'plan_a'),
  1,
  'and the required-member list'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a3');
select is(
  (select count(*)::integer from public.plan_participants),
  0,
  'somebody outside the circle reads no participants'
);
select is(
  (select count(*)::integer from public.plan_required_members),
  0,
  'and no required members'
);

-- ---------------------------------------------------------------------------
-- Reads, and the absence of writes.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select ok(
  (select count(*) from public.plans) > 0,
  'a member sees their circle''s plans'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a3');
select is((select count(*)::integer from public.plans), 0, 'a non-member sees none');

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select ok(
  not has_table_privilege('authenticated', 'public.plans', 'insert'),
  'no client inserts a plan — create-plan does, with its own rules'
);
select ok(
  not has_table_privilege('authenticated', 'public.plans', 'update'),
  'and none updates one'
);
select ok(
  not has_table_privilege('authenticated', 'public.plan_participants', 'insert'),
  'nor opts themselves into a plan'
);

-- ---------------------------------------------------------------------------
-- The window cap.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select throws_ok(
  $$insert into public.plans (
      circle_id, mode, state, organiser_user_id, title, time_zone,
      window_start, window_end, daily_start_local, daily_end_local,
      duration_minutes, quorum, response_deadline, short_code
    )
    select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000001a1',
      'Fortnight and a day', 'Australia/Melbourne',
      date '2026-09-01', date '2026-09-15', 1050, 1350, 120, 4,
      timestamptz '2026-09-15T09:00:00Z', 'pnhhhh'
    from t$$,
  '23514',
  null,
  'fifteen consecutive days is refused; fourteen is the cap (spec §5.3)'
);

select ok(
  (select count(*) from public.plans
   where window_end - window_start = 13) >= 0,
  'and the inclusive reading is what the constraint uses'
);

select * from finish();
rollback;
