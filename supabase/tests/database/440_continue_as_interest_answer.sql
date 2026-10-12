-- A Continue-as pick does not hand the taker the previous holder's quiet-ask
-- answer (SUS-182, ADR 0062).
--
-- `quiet_viewer_facts` is what `quiet-view` turns into "you answered" and the
-- keen-only actions, so what it returns for the taker is what the taker's screen
-- can show. Asserted as the people involved, with a JWT.

begin;
select plan(21);

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

create or replace function pg_temp.digest_of(secret text)
returns bytea
language sql
as $$ select extensions.digest(secret, 'sha256') $$;

-- Maya owns the circle. Nina and Tom are guests; Sam is a guest with an address.
select pg_temp.make_user('18200000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('18200000-0000-0000-0000-0000000000a1', 'Nina', true);
select pg_temp.make_user('18200000-0000-0000-0000-0000000000a2', 'Tom', true);
select pg_temp.make_user('18200000-0000-0000-0000-0000000000a3', 'Sam', true);
select pg_temp.make_user('18200000-0000-0000-0000-0000000000b1', 'Taker', true);
select pg_temp.make_user('18200000-0000-0000-0000-0000000000b2', 'Sam new phone', true);

select pg_temp.act_as('18200000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id from public.create_circle('Quiet Crew', 'sky', 'Australia/Melbourne', 'sus182-quiet');
grant select on fixture to authenticated;

select pg_temp.act_as_postgres();

create or replace function pg_temp.circle_id() returns uuid
language sql security definer as $$ select circle_id from fixture $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '18200000-0000-0000-0000-0000000000a1', 'Nina'),
       (pg_temp.circle_id(), '18200000-0000-0000-0000-0000000000a2', 'Tom'),
       (pg_temp.circle_id(), '18200000-0000-0000-0000-0000000000a3', 'Sam');

-- A live named plan, so the list is a way back in at all (ADR 0059).
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
values (pg_temp.circle_id(), 'named', 'collecting',
        '18200000-0000-0000-0000-000000000001', 'Catch up', 'Australia/Melbourne',
        date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
        timestamptz '2099-09-20T10:00:00Z', 'kvqrstdw');

-- Two quiet asks: one still seeking, one that has opened.
create or replace function pg_temp.make_quiet(p_code text, p_state text) returns uuid
language plpgsql security definer as $$
declare new_id uuid;
begin
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code,
    quiet_threshold, quiet_expires_at, quiet_preset
  )
  values (pg_temp.circle_id(), 'quiet', p_state, null, 'Catch up', 'Australia/Melbourne',
          date '2099-09-14', date '2099-09-20', 1050, 1350, 120, 4,
          timestamptz '2099-09-20T10:00:00Z', p_code, 3,
          timestamptz '2099-09-19T10:00:00Z', 'next_7_days')
  returning id into new_id;
  return new_id;
end;
$$;

select pg_temp.make_quiet('kvqseekp', 'seeking') as seeking \gset
select pg_temp.make_quiet('kvqsrtwp', 'collecting') as opened \gset
grant select on fixture to authenticated;

insert into private.plan_interest (plan_id, user_id, response) values
  (:'seeking', '18200000-0000-0000-0000-0000000000a1', 'keen'),
  (:'seeking', '18200000-0000-0000-0000-0000000000a2', 'keen'),
  (:'seeking', '18200000-0000-0000-0000-0000000000a3', 'keen'),
  (:'opened',  '18200000-0000-0000-0000-0000000000a1', 'keen'),
  (:'opened',  '18200000-0000-0000-0000-0000000000a2', 'not_this_time'),
  (:'opened',  '18200000-0000-0000-0000-0000000000a3', 'keen');

create or replace function pg_temp.my_answer(p_plan uuid, p_user uuid) returns text
language sql security definer as $$
  select public.quiet_viewer_facts(p_plan, p_user) ->> 'my_answer'
$$;
create or replace function pg_temp.keen_rows(p_plan uuid) returns integer
language sql security definer as $$
  select count(*)::integer from private.plan_interest where plan_id = p_plan and response = 'keen'
$$;

select is(pg_temp.my_answer(:'seeking', '18200000-0000-0000-0000-0000000000a1'), 'keen',
  'before anything moves, Nina sees her own answer to the ask that is still seeking');
select is(pg_temp.my_answer(:'opened', '18200000-0000-0000-0000-0000000000a2'), 'not_this_time',
  'and Tom his, to the ask that has opened');

-- ---------------------------------------------------------------------------
-- A pick from the list: the taker starts with no answer
-- ---------------------------------------------------------------------------
select pg_temp.act_as('18200000-0000-0000-0000-0000000000b1', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '18200000-0000-0000-0000-0000000000a1') $$,
  'somebody picks Nina from the Continue-as list and takes her place'
);
select pg_temp.act_as_postgres();

select is(
  (select m.user_id from public.circle_members m
   where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = 'Nina'),
  '18200000-0000-0000-0000-0000000000b1'::uuid,
  'the place is the taker''s'
);
select is(pg_temp.my_answer(:'seeking', '18200000-0000-0000-0000-0000000000b1'), null,
  'the taker sees no answer to the ask that is still seeking');
select is(pg_temp.my_answer(:'opened', '18200000-0000-0000-0000-0000000000b1'), null,
  'and none to the ask that has opened, so no keen-only action is offered');
select is(
  (select count(*)::integer from private.plan_interest where user_id = '18200000-0000-0000-0000-0000000000b1'),
  0,
  'the taker owns no interest row at all'
);
select is(
  (select count(*)::integer from private.plan_interest
   where plan_id = :'seeking' and user_id = '18200000-0000-0000-0000-0000000000a1'),
  0,
  'while the ask is seeking, the previous holder''s row is gone, as removal does, so the real Nina can answer again without being counted twice'
);
select is(
  (select count(*)::integer from private.plan_interest
   where plan_id = :'opened' and user_id = '18200000-0000-0000-0000-0000000000a1' and response = 'keen'),
  1,
  'once the ask has opened, the row stays under the identity it was given under'
);
select is(pg_temp.keen_rows(:'opened'), 2, 'so the opened ask''s count is what it opened with');
select is(pg_temp.keen_rows(:'seeking'), 2, 'and the seeking ask lost only the answer that went with the place');

select pg_temp.act_as('18200000-0000-0000-0000-0000000000a3', true);
select is(
  (select count(*)::integer from public.plan_interest_counts where plan_id = :'opened'),
  1, 'the count view still answers for the opened ask');
select pg_temp.act_as('18200000-0000-0000-0000-0000000000b1', true);
select is(
  (select keen_count from public.plan_interest_counts where plan_id = :'opened'),
  2, 'and gives the taker the same number, as a member');
select pg_temp.act_as_postgres();

select is(
  (select count(*)::integer from private.plan_interest
   where plan_id = :'seeking' and user_id = '18200000-0000-0000-0000-0000000000a2'),
  1, 'Tom''s answer, whose place nobody took, is untouched');

-- The taker answering is the taker's own answer, and is theirs to read.
select lives_ok(
  $$ select public.record_interest((select id from public.plans where short_code = 'kvqseekp'),
       '18200000-0000-0000-0000-0000000000b1', false, null) $$,
  'the taker answers the seeking ask themselves'
);
select is(pg_temp.my_answer(:'seeking', '18200000-0000-0000-0000-0000000000b1'), 'not_this_time',
  'and sees that answer, not Nina''s');

-- ---------------------------------------------------------------------------
-- The emailed link: the mailbox proved the person, so their answer comes with them
-- ---------------------------------------------------------------------------
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('18200000-0000-0000-0000-0000000000a3', 'sam-quiet@example.com', 'verified', now() - interval '2 days');
select public.issue_reentry_token(
  pg_temp.circle_id(),
  (select id from private.email_contacts where email_normalized = 'sam-quiet@example.com'),
  extensions.digest('sam-quiet-link', 'sha256'));

select pg_temp.act_as('18200000-0000-0000-0000-0000000000b2', true);
select lives_ok(
  $$ select public.reattach_member(null, null, extensions.digest('sam-quiet-link', 'sha256')) $$,
  'Sam comes back on a new phone with his emailed link'
);
select pg_temp.act_as_postgres();
select is(pg_temp.my_answer(:'seeking', '18200000-0000-0000-0000-0000000000b2'), 'keen',
  'and still sees his own answer to the seeking ask');
select is(pg_temp.my_answer(:'opened', '18200000-0000-0000-0000-0000000000b2'), 'keen',
  'and to the opened one');
select is(pg_temp.keen_rows(:'seeking'), 2, 'nothing was counted twice or lost: the seeking count is the same');

-- ---------------------------------------------------------------------------
-- The setting does not leak out of the move
-- ---------------------------------------------------------------------------
select is(current_setting('circles.carry_interest', true), 'on',
  'after a list pick the switch is back on for whatever runs next in the transaction');

select * from finish();
rollback;
