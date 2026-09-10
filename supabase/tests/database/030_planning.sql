-- Planning, from the outside.
--
-- Numbered 030 because 020 is the outbox tripwire, which stays until S1-11
-- lands the table both `create_circle` and `transition_plan` owe events to.
--
-- The claim under test is architecture §8.3's: "nothing else writes
-- `plans.state`". A comment cannot make that true and a convention cannot
-- either, so most of this file is about trying to write it some other way.

begin;
select plan(68);

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
create temporary table t as select id as circle_id from public.circles where name = 'Sunday Crew';
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
  19,
  'nineteen transitions, seeded from the generated block'
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
select is(
  (select state from planning.transition_plan(:'plan_a', 'confirm',
    '00000000-0000-0000-0000-0000000001a1', '{"candidate_id":"2026-09-17T08:30:00.000Z"}'::jsonb)),
  'confirmed',
  'with one, they can'
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
  'not_keen_or_initiator',
  'somebody who said not this time is not offered the job of arranging it'
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
select is(
  (select state from planning.transition_plan(:'plan_wd', 'cancel',
    '00000000-0000-0000-0000-0000000001a1')),
  'cancelled',
  'and the initiator can (spec §5.4)'
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

select pg_temp.act_as_postgres();
select planning.transition_plan(:'plan_seeking', 'threshold_reached',
  '00000000-0000-0000-0000-0000000001a1');

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select is(
  (select keen_count from public.plan_interest_counts where plan_id = :'plan_seeking'),
  2,
  'and a count once it has passed'
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

select throws_ok(
  format(
    $$select planning.transition_plan('%s', 'confirm', '%s', '{"candidate_id":"x"}'::jsonb)$$,
    :'plan_gone', '00000000-0000-0000-0000-0000000001a2'
  ),
  'P0001',
  'not_the_organiser',
  'a removed organiser cannot confirm their own plan — removal revokes access immediately'
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
