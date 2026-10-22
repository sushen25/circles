-- A signed-in account can continue as a guest (SUS-245, ADR 0088).
--
-- Alex answered a plan as a guest, then opens the same link where they are
-- signed in. They pick "Alex" from the Continue-as list and the place, with
-- its answer, moves onto the account. Everything else that bounds a list pick
-- still applies, to an account as to a guest.
--
-- Sunday Crew: Maya owns it. Alex and Tom are guests, Nina has saved her place,
-- Jess has an account and is a member. Sam has an account and is not a member
-- (Sam is Alex, signed in). Ben has just signed up, so his JWT still says
-- anonymous.

begin;
select plan(25);

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

select pg_temp.make_user('52000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('52000000-0000-0000-0000-000000000002', 'Alex', true);
select pg_temp.make_user('52000000-0000-0000-0000-000000000003', 'Tom', true);
select pg_temp.make_user('52000000-0000-0000-0000-000000000004', 'Nina');
select pg_temp.make_user('52000000-0000-0000-0000-000000000005', 'Jess');
select pg_temp.make_user('52000000-0000-0000-0000-000000000006', 'Sam on the laptop');
select pg_temp.make_user('52000000-0000-0000-0000-000000000007', 'Ben', true);
select pg_temp.make_user('52000000-0000-0000-0000-000000000008', 'Zed', true);
select pg_temp.make_user('52000000-0000-0000-0000-000000000009', 'Una');
select pg_temp.make_user('52000000-0000-0000-0000-00000000000a', 'Una the guest', true);

select pg_temp.act_as('52000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id
from public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'sus245-claim');
grant select on fixture to authenticated;

select pg_temp.act_as_postgres();

create or replace function pg_temp.circle_id() returns uuid
language sql security definer as $$ select circle_id from fixture $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '52000000-0000-0000-0000-000000000002', 'Alex'),
       (pg_temp.circle_id(), '52000000-0000-0000-0000-000000000003', 'Tom'),
       (pg_temp.circle_id(), '52000000-0000-0000-0000-000000000004', 'Nina'),
       (pg_temp.circle_id(), '52000000-0000-0000-0000-000000000005', 'Jess');

-- Nina saved her place, in place.
update auth.users set is_anonymous = false, raw_app_meta_data = '{"is_anonymous": false}'
where id = '52000000-0000-0000-0000-000000000004';
update public.profiles set is_permanent = true
where user_id = '52000000-0000-0000-0000-000000000004';

-- Ben has just signed up: the durable records say permanent, his JWT does not yet.
update auth.users set is_anonymous = false, raw_app_meta_data = '{"is_anonymous": false}'
where id = '52000000-0000-0000-0000-000000000007';
update public.profiles set is_permanent = true
where user_id = '52000000-0000-0000-0000-000000000007';

-- A live plan, so the list path is open (ADR 0049, 0059).
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
values (pg_temp.circle_id(), 'named', 'collecting',
        '52000000-0000-0000-0000-000000000001', 'Catch up', 'Australia/Melbourne',
        date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
        timestamptz '2099-09-20T10:00:00Z', 'acctgst');

create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$
  select id from public.plans where short_code = 'acctgst';
$$;

insert into public.plan_responses (plan_id, revision, user_id, status)
values (pg_temp.plan_id(), 1, '52000000-0000-0000-0000-000000000002', 'flexible');

-- Alex once asked for plan updates, so there is an emailed way back in.
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('52000000-0000-0000-0000-000000000002', 'alex@example.com', 'verified', now());
select public.issue_reentry_token(
  pg_temp.circle_id(),
  (select id from private.email_contacts where email_normalized = 'alex@example.com'),
  extensions.digest('alex-reentry-link', 'sha256'));

-- Alex asked to be emailed about this plan: a verified address and a consent.
insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select c.id, c.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts c where c.email_normalized = 'alex@example.com';

-- Zed is a guest in another circle, which Maya owns too.
select pg_temp.act_as('52000000-0000-0000-0000-000000000001');
create temporary table other_fixture as
select id as circle_id
from public.create_circle('Other crew', 'sky', 'Australia/Melbourne', 'sus245-other');
grant select on other_fixture to authenticated;
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '52000000-0000-0000-0000-000000000008', 'Zed' from other_fixture;

-- ---------------------------------------------------------------------------
-- The list, as an account sees it
-- ---------------------------------------------------------------------------
select pg_temp.act_as('52000000-0000-0000-0000-000000000006');

select set_eq(
  $$ select display_name from public.guest_members_for_reattach('acctgst') $$,
  array['Alex', 'Tom'],
  'a signed-in account sees the guests, and never a saved place'
);

-- ---------------------------------------------------------------------------
-- The allow: Sam picks Alex
-- ---------------------------------------------------------------------------
select is(
  (select id from public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000002')),
  pg_temp.circle_id(),
  'a signed-in account can pick a guest''s name from the list'
);

select pg_temp.act_as_postgres();

select is(
  (select user_id from public.circle_members
   where circle_id = pg_temp.circle_id() and display_name_snapshot = 'Alex'),
  '52000000-0000-0000-0000-000000000006'::uuid,
  'the place is now the account''s'
);

select is(
  (select display_name_snapshot from public.circle_members
   where circle_id = pg_temp.circle_id() and user_id = '52000000-0000-0000-0000-000000000006'),
  'Alex',
  'and the circle still calls it Alex'
);

select is(
  (select display_name from public.profiles where user_id = '52000000-0000-0000-0000-000000000006'),
  'Sam on the laptop',
  'while the account''s own name is untouched (ADR 0065)'
);

select is(
  (select user_id from public.plan_responses where plan_id = pg_temp.plan_id()),
  '52000000-0000-0000-0000-000000000006'::uuid,
  'the answer moved with the place'
);

select ok(
  not exists (
    select 1 from public.circle_members
    where circle_id = pg_temp.circle_id() and user_id = '52000000-0000-0000-0000-000000000002'
  ),
  'and the guest identity holds nothing here any more'
);

select ok(
  (select used_at is not null and retired_at is not null from private.email_action_tokens
   where token_hash = extensions.digest('alex-reentry-link', 'sha256')),
  'the guest''s emailed link is retired, as when a guest saves their place'
);

select is(
  (select metadata from private.audit_log
   where action = 'circles.member_reattached' and actor_user_id = '52000000-0000-0000-0000-000000000006'),
  jsonb_build_object('from_user_id', '52000000-0000-0000-0000-000000000002',
                     'to_user_id', '52000000-0000-0000-0000-000000000006',
                     'source', 'list', 'from_saved_account', false),
  'the move is audited as a list pick'
);

select is(
  (select c.user_id from private.email_contacts c where c.email_normalized = 'alex@example.com'),
  '52000000-0000-0000-0000-000000000006'::uuid,
  'Alex''s address follows the place to the account (this circle''s contacts move)'
);

select is(
  (select s.user_id from private.email_subscriptions s where s.plan_id = pg_temp.plan_id()),
  '52000000-0000-0000-0000-000000000006'::uuid,
  'and so does the plan-update consent, still scoped to the one plan'
);

select pg_temp.act_as('52000000-0000-0000-0000-000000000006');

select is(
  (select count(*)::integer from public.circles where id = pg_temp.circle_id()),
  1,
  'the account can now read the circle as a member'
);

select set_eq(
  $$ select display_name from public.guest_members_for_reattach('acctgst') $$,
  array['Tom'],
  'and the place is off the list: it is a saved place now'
);

select is(
  (select id from public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000006')),
  pg_temp.circle_id(),
  'picking a place already one''s own is a no-op that returns the circle (a retry is safe)'
);

select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000008') $$,
  'member_not_found',
  'a pick in one circle cannot reach a guest of another'
);

-- ---------------------------------------------------------------------------
-- The denies
-- ---------------------------------------------------------------------------
select pg_temp.act_as('52000000-0000-0000-0000-000000000007', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000006') $$,
  'target_is_permanent',
  'nobody takes a place an account now holds'
);

select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000004') $$,
  'target_is_permanent',
  'nor a saved-place member''s'
);

select pg_temp.act_as('52000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000003') $$,
  'already_member',
  'an account already in the circle is told so, and takes no second place'
);

select pg_temp.act_as('52000000-0000-0000-0000-000000000007', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-00000000dead') $$,
  'member_not_found',
  'somebody who is not in the circle cannot be picked'
);

-- Once no plan is live, the list path is closed to an account as to a guest.
select pg_temp.act_as_postgres();
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'cancelled' where id = pg_temp.plan_id();
select set_config('circles.in_transition', 'off', true);

select pg_temp.act_as('52000000-0000-0000-0000-000000000007', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000003') $$,
  'member_not_found',
  'no live plan, no pick'
);

-- An account that was in the circle and left can take its guest place: the old
-- row makes room (as claim_identity does), and an active member still cannot.
select pg_temp.act_as_postgres();
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'collecting' where id = pg_temp.plan_id();
select set_config('circles.in_transition', 'off', true);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '52000000-0000-0000-0000-000000000009', 'Una');
update public.circle_members set status = 'removed'
where circle_id = pg_temp.circle_id() and user_id = '52000000-0000-0000-0000-000000000009';
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '52000000-0000-0000-0000-00000000000a', 'Una');

select pg_temp.act_as('52000000-0000-0000-0000-000000000009');
select is(
  (select id from public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-00000000000a')),
  pg_temp.circle_id(),
  'an account that once left the circle can take its guest place'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.circle_members
   where circle_id = pg_temp.circle_id() and user_id = '52000000-0000-0000-0000-000000000009'
     and status = 'active' and display_name_snapshot = 'Una'),
  1,
  'and holds exactly one active place there'
);
select is(
  (select count(*)::integer from public.circle_members
   where circle_id = pg_temp.circle_id() and user_id = '52000000-0000-0000-0000-000000000009'),
  1,
  'with no removed row left beside it'
);

-- The per-circle hourly limit counts an account's moves as a guest's.
select pg_temp.act_as_postgres();
select public.take_rate_token(
  'reattach_circle_sql', extensions.digest(pg_temp.circle_id()::text, 'sha256'), 20, interval '1 hour')
from generate_series(1, 20);

select pg_temp.act_as('52000000-0000-0000-0000-000000000007', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '52000000-0000-0000-0000-000000000003') $$,
  'too_many_requests',
  'twenty moves an hour a circle, for an account as for a guest'
);

select pg_temp.act_as_postgres();
select is(
  (select user_id from public.circle_members
   where circle_id = pg_temp.circle_id() and display_name_snapshot = 'Tom'),
  '52000000-0000-0000-0000-000000000003'::uuid,
  'and Tom''s place stayed his through every refusal'
);

select * from finish();
rollback;
