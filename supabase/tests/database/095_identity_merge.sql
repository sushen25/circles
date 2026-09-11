-- Moving a membership between identities: Continue as (ADR 0006) and saving a
-- place on top of an account that already existed (§10).
--
-- The thing worth testing here is not that one row changes. It is that *every*
-- row a member owns goes with them — a guest who comes back and finds their
-- answers gone is the failure this whole design exists to prevent — and that a
-- membership can never be moved onto somebody with a saved place.

begin;
select plan(132);

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

-- ---------------------------------------------------------------------------
-- Sunday Crew: Maya owns it, Priya is a guest with a full history, and three
-- spare devices stand by for the chain.
-- ---------------------------------------------------------------------------
select pg_temp.make_user('95000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('95000000-0000-0000-0000-0000000000a1', 'Priya', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000000b1', 'Device B', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000000c1', 'Device C', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000000d1', 'Device D', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000000e1', 'Device E', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000000f1', 'Priya Saved');
select pg_temp.make_user('95000000-0000-0000-0000-0000000000f2', 'Tom', true);

select pg_temp.act_as('95000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id, short_code
from public.create_circle('Sunday Crew', '#336699', 'Australia/Melbourne', 'sus29-merge');

select pg_temp.act_as_postgres();

create or replace function pg_temp.circle_id() returns uuid
language sql security definer as $$ select circle_id from fixture $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000a1', 'Priya'),
       (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000f2', 'Tom');

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
values (pg_temp.circle_id(), 'named', 'collecting',
        '95000000-0000-0000-0000-000000000001', 'Catch up', 'Australia/Melbourne',
        date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
        timestamptz '2099-09-20T10:00:00Z', 'mrgpen');

create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$
  select id from public.plans where short_code = 'mrgpen';
$$;

insert into public.plan_responses (plan_id, revision, user_id, status)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000000a1', 'flexible');
insert into public.plan_participants (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000000a1')
on conflict do nothing;
insert into public.plan_required_members (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000000a1')
on conflict do nothing;
insert into public.nudge_states (user_id, moment, plan_id)
values ('95000000-0000-0000-0000-0000000000a1', 'after_answer', pg_temp.plan_id());

insert into public.candidate_sets (
  plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
values (pg_temp.plan_id(), 1, 1, 1, repeat('a', 64), 10, 1, 1, 3);

insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select cs.id, false, 1, timestamptz '2099-09-17T08:30:00Z', timestamptz '2099-09-17T10:30:00Z',
       array['95000000-0000-0000-0000-0000000000a1'::uuid], 0, 1, 'best_attendance', 1
from public.candidate_sets cs where cs.plan_id = pg_temp.plan_id();

-- ---------------------------------------------------------------------------
-- The move itself
-- ---------------------------------------------------------------------------
select pg_temp.act_as('95000000-0000-0000-0000-0000000000b1', true);

select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000a1') $$,
  'a guest with no session reattaches to the name they picked from the list'
);

select pg_temp.act_as_postgres();

select is(
  (select m.user_id from public.circle_members m
   where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = 'Priya'),
  '95000000-0000-0000-0000-0000000000b1'::uuid,
  'the membership is the new identity''s'
);

select is(
  (select count(*)::integer from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '95000000-0000-0000-0000-0000000000a1'),
  0,
  'and the old one holds nothing in this circle'
);

select isnt_empty(
  $$ select 1 from auth.users where id = '95000000-0000-0000-0000-0000000000a1' $$,
  'the abandoned identity is left for retention to sweep, not deleted here'
);

select is(
  (select r.user_id from public.plan_responses r where r.plan_id = pg_temp.plan_id()),
  '95000000-0000-0000-0000-0000000000b1'::uuid,
  'the answer they gave came with them'
);

select is(
  (select pp.user_id from public.plan_participants pp where pp.plan_id = pg_temp.plan_id()),
  '95000000-0000-0000-0000-0000000000b1'::uuid,
  'so did their place in the participant list'
);

select is(
  (select rm.user_id from public.plan_required_members rm where rm.plan_id = pg_temp.plan_id()),
  '95000000-0000-0000-0000-0000000000b1'::uuid,
  'and their place among the required members'
);

select is(
  (select n.user_id from public.nudge_states n where n.plan_id = pg_temp.plan_id()),
  '95000000-0000-0000-0000-0000000000b1'::uuid,
  'and the prompts they have already been shown, so they are not shown again'
);

select is(
  (select c.available_user_ids from public.candidates c
   join public.candidate_sets cs on cs.id = c.candidate_set_id
   where cs.plan_id = pg_temp.plan_id()),
  array['95000000-0000-0000-0000-0000000000b1'::uuid],
  'and the candidate''s available set — which is what decides who is "going" at confirm'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'circles.member_reattached'),
  1,
  'the circle is told somebody rejoined'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'availability.response_submitted'
     -- Scoped to this plan: the seed's own scenarios have answered their plans,
     -- and those events are in the outbox too.
     and o.payload ->> 'plan_id' = pg_temp.plan_id()::text),
  1,
  'and is not told they answered again — one event, from giving the answer, not from moving it'
);

select is(
  (select o.payload ->> 'source' from jobs.outbox o
   where o.event_name = 'circles.member_reattached'),
  'list',
  'and told which way they came back, because the reattach rate is by source'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'circles.member_reattached'
     and o.payload::text like '%Priya%'),
  0,
  'without a name in the payload (non-negotiable 8)'
);

-- ---------------------------------------------------------------------------
-- Three in seven days, and the fourth is refused (ADR 0006). The count walks a
-- chain of identities, because every move changes the one the rows name.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('95000000-0000-0000-0000-0000000000c1', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000b1') $$,
  'a second move is allowed'
);

select pg_temp.act_as('95000000-0000-0000-0000-0000000000d1', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000c1') $$,
  'and a third'
);

select pg_temp.act_as('95000000-0000-0000-0000-0000000000e1', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000d1') $$,
  'reattach_limit',
  'the fourth inside seven days is refused'
);

select pg_temp.act_as_postgres();
select is(
  (select r.user_id from public.plan_responses r where r.plan_id = pg_temp.plan_id()),
  '95000000-0000-0000-0000-0000000000d1'::uuid,
  'the answer followed the membership along the whole chain'
);

-- The limit is seven days, not forever: age the chain and the door opens again.
update private.audit_log a
set occurred_at = occurred_at - interval '8 days'
where a.action = 'circles.member_reattached';

select pg_temp.act_as('95000000-0000-0000-0000-0000000000e1', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000d1') $$,
  'once the week has passed, the allowance is back'
);

-- ---------------------------------------------------------------------------
-- Who may not be moved, and who may not do the moving
-- ---------------------------------------------------------------------------
select pg_temp.act_as('95000000-0000-0000-0000-0000000000c1', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-000000000001') $$,
  'target_is_permanent',
  'a saved-place member can never be reattached to'
);

select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-00000000dead') $$,
  'member_not_found',
  'and neither can somebody who is not in the circle'
);

select pg_temp.act_as('95000000-0000-0000-0000-0000000000f1');
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000e1') $$,
  'caller_is_permanent',
  'a caller with a saved place signs in instead of reattaching'
);

select pg_temp.act_as('95000000-0000-0000-0000-0000000000f2', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000e1') $$,
  'already_member',
  'a caller already in the circle under their own name is told so'
);

select throws_ok(
  $$ select public.reattach_member() $$,
  'reattach_member takes a target membership or a re-entry token, not both and not neither',
  'neither a membership nor a token is a programming error, not a silent no-op'
);

select throws_ok(
  format($$ select public.reattach_member(%L, %L, %L) $$,
         pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000e1',
         extensions.digest('anything', 'sha256')),
  'reattach_member takes a target membership or a re-entry token, not both and not neither',
  'and so is both at once'
);

select pg_temp.act_as('95000000-0000-0000-0000-0000000000c1', true);
select throws_ok(
  format($$ select public.reattach_member(null, null, %L) $$,
         extensions.digest('never-issued', 'sha256')),
  'token_invalid',
  'a token nobody issued authorises nothing'
);

-- ---------------------------------------------------------------------------
-- The emailed way back in (§10, §14: single-use, 7-day, bound to a membership)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000000e1', 'priya@example.com');

insert into private.email_action_tokens (
  contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
)
select ec.id, 'reentry', extensions.digest('reentry-secret', 'sha256'),
       now() + interval '7 days', pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000e1'
from private.email_contacts ec where ec.email_normalized = 'priya@example.com';

select pg_temp.make_user('95000000-0000-0000-0000-0000000000e2', 'Device E2', true);
select pg_temp.act_as('95000000-0000-0000-0000-0000000000e2', true);

select lives_ok(
  format($$ select public.reattach_member(null, null, %L) $$,
         extensions.digest('reentry-secret', 'sha256')),
  'an emailed re-entry token moves the membership without the list'
);

select pg_temp.act_as_postgres();
select is(
  (select m.user_id from public.circle_members m
   where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = 'Priya'),
  '95000000-0000-0000-0000-0000000000e2'::uuid,
  'onto the identity that held the token'
);

select is(
  (select o.payload ->> 'source' from jobs.outbox o
   where o.event_name = 'circles.member_reattached'
   order by o.seq desc limit 1),
  'email',
  'recorded as the emailed path, not the list'
);

select is(
  (select ec.user_id from private.email_contacts ec
   where ec.email_normalized = 'priya@example.com'),
  '95000000-0000-0000-0000-0000000000e2'::uuid,
  'and their email contact came too — the token''s deferred constraint requires it'
);

select isnt_empty(
  $$ select 1 from private.email_action_tokens where used_at is not null $$,
  'the token is spent'
);

select pg_temp.make_user('95000000-0000-0000-0000-0000000000e3', 'Device E3', true);
select pg_temp.act_as('95000000-0000-0000-0000-0000000000e3', true);
select throws_ok(
  format($$ select public.reattach_member(null, null, %L) $$,
         extensions.digest('reentry-secret', 'sha256')),
  'token_invalid',
  'and cannot be spent twice'
);

-- ---------------------------------------------------------------------------
-- claim_identity (§10)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select ok(
  not has_function_privilege('authenticated', 'public.claim_identity(uuid, uuid, text)', 'execute'),
  'no client may call claim_identity: the identity it acts on is an argument'
);

select ok(
  not has_function_privilege('anon', 'public.claim_identity(uuid, uuid, text)', 'execute'),
  'not even to try'
);

select ok(
  has_function_privilege('service_role', 'public.claim_identity(uuid, uuid, text)', 'execute'),
  'only the Edge Function, which has checked the old session''s token'
);

select ok(
  not has_function_privilege('authenticated', 'private.move_membership(uuid, uuid, uuid)', 'execute'),
  'and the move itself is reachable by nobody outside the database'
);

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-0000000000f1',
                        '95000000-0000-0000-0000-0000000000e2', 'after_answer')),
  1,
  'saving a place onto an account that already existed merges the one membership'
);

select is(
  (select m.user_id from public.circle_members m
   where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = 'Priya'),
  '95000000-0000-0000-0000-0000000000f1'::uuid,
  'the membership is now the saved-place identity''s'
);

select is(
  (select r.user_id from public.plan_responses r where r.plan_id = pg_temp.plan_id()),
  '95000000-0000-0000-0000-0000000000f1'::uuid,
  'with the answers still attached'
);

select ok(
  (select p.is_permanent from public.profiles p
   where p.user_id = '95000000-0000-0000-0000-0000000000f1'),
  'and the profile records the saved place'
);

select is(
  (select count(*)::integer from jobs.outbox o where o.event_name = 'growth.account_claimed'),
  1,
  'the claim is announced once'
);

select is(
  (select o.payload ->> 'moment' from jobs.outbox o
   where o.event_name = 'growth.account_claimed'),
  'after_answer',
  'with the moment it happened at, which is what the funnel is measured by'
);

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-0000000000f1',
                        '95000000-0000-0000-0000-0000000000e2', 'after_answer')),
  0,
  'saying it again merges nothing'
);

select is(
  (select count(*)::integer from jobs.outbox o where o.event_name = 'growth.account_claimed'),
  1,
  'and does not count a second conversion'
);

select throws_ok(
  $$ select * from public.claim_identity('95000000-0000-0000-0000-0000000000f1',
                                  '95000000-0000-0000-0000-000000000001', 'settings') $$,
  'source_is_permanent',
  'memberships are never moved off another saved place: that would be taking an account'
);

select throws_ok(
  $$ select * from public.claim_identity('95000000-0000-0000-0000-0000000000f1',
                                  '95000000-0000-0000-0000-0000000000e3', 'whenever') $$,
  'claim_identity got an unknown moment',
  'and a moment the analytics catalogue does not know is refused here, not dropped later'
);

-- A collision: the saved-place identity is already in the circle under its own
-- name, and the guest row it is merging is a second membership in the same one.
select pg_temp.make_user('95000000-0000-0000-0000-0000000000a9', 'Jess', true);
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000a9', 'Jess on her phone');
insert into public.plan_responses (plan_id, revision, user_id, status)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000000a9', 'flexible');

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-0000000000f1',
                        '95000000-0000-0000-0000-0000000000a9', 'settings')),
  0,
  'a membership that would collide is not moved'
);

select is(
  (select m.status from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '95000000-0000-0000-0000-0000000000a9'),
  'removed',
  'the duplicate is removed instead — the saved place is the one that keeps working'
);

select is(
  (select count(*)::integer from public.plan_responses r
   where r.plan_id = pg_temp.plan_id()
     and r.user_id = '95000000-0000-0000-0000-0000000000a9'),
  0,
  'and removal takes its answers with it, as removal always does'
);

-- ---------------------------------------------------------------------------
-- Round 1: the history can be a cycle.
--
-- A membership moves A→B; later, from the session on device A that is still
-- perfectly valid, it moves B→A. The audit chain now loops, and the walk that
-- counts it followed A→B→A→B with `union all` until the server gave up. The
-- timeout below is the assertion: a regression does not fail this test slowly, it
-- hangs the suite, and that is worth making impossible.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
set local statement_timeout = '10s';

select pg_temp.make_user('95000000-0000-0000-0000-00000000c0d1'::uuid, 'Cycle Owner');
select pg_temp.make_user('95000000-0000-0000-0000-00000000c0d2'::uuid, 'Device One', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000c0d3'::uuid, 'Device Two', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000c0d4'::uuid, 'Device Three', true);

select pg_temp.act_as('95000000-0000-0000-0000-00000000c0d1');
create temporary table cycle_fixture as
select id as circle_id from public.create_circle('Cycle Crew', '#336699', 'Australia/Melbourne', 'cyc-1');

select pg_temp.act_as_postgres();
create or replace function pg_temp.cycle_circle() returns uuid
language sql security definer as $$ select circle_id from cycle_fixture $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.cycle_circle(), '95000000-0000-0000-0000-00000000c0d2', 'Nic');

select pg_temp.act_as('95000000-0000-0000-0000-00000000c0d3', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.cycle_circle(), '95000000-0000-0000-0000-00000000c0d2') $$,
  'the membership moves to the second device'
);

-- And back again, from the first device, whose session never stopped working.
select pg_temp.act_as('95000000-0000-0000-0000-00000000c0d2', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.cycle_circle(), '95000000-0000-0000-0000-00000000c0d3') $$,
  'and back to the first, which is what makes the history a loop'
);

select pg_temp.act_as('95000000-0000-0000-0000-00000000c0d4', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.cycle_circle(), '95000000-0000-0000-0000-00000000c0d2') $$,
  'a third move terminates instead of walking the loop for ever'
);

select pg_temp.act_as('95000000-0000-0000-0000-00000000c0d3', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.cycle_circle(), '95000000-0000-0000-0000-00000000c0d4') $$,
  'reattach_limit',
  'and the loop is still counted as three moves, not as two or as infinity'
);

-- ---------------------------------------------------------------------------
-- Round 1: the email contact is merged, not moved.
--
-- A guest asks for plan-update email at an address, then saves their place and
-- turns out to have an account at the same address. Uniqueness is
-- `(email_hash, user_id)`, so moving the contact collided and rolled back the
-- whole merge — the architecture's own table for `email_action_tokens` says this
-- must merge, and SUS-75 left the note there.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select pg_temp.make_user('95000000-0000-0000-0000-0000000000e5'::uuid, 'Jess Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000000e6'::uuid, 'Jess Saved');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000000e5', 'Jess');

-- Both identities hold the same address: the guest through the plan, the account
-- from before.
insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000000e5', 'jess@example.com'),
       ('95000000-0000-0000-0000-0000000000e6', 'jess@example.com');

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts ec
where ec.user_id = '95000000-0000-0000-0000-0000000000e5';

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-0000000000e6',
                        '95000000-0000-0000-0000-0000000000e5', 'after_answer')),
  1,
  'the membership moves even though both identities hold the address'
);

select is(
  (select count(*)::integer from private.email_contacts ec
   where ec.email_normalized = 'jess@example.com'),
  1,
  'one contact for the address, not two'
);

select is(
  (select ec.user_id from private.email_contacts ec
   where ec.email_normalized = 'jess@example.com'),
  '95000000-0000-0000-0000-0000000000e6'::uuid,
  'and it is the one the saved place already owned'
);

select is(
  (select s.user_id from private.email_subscriptions s where s.plan_id = pg_temp.plan_id()),
  '95000000-0000-0000-0000-0000000000e6'::uuid,
  'the consent came across to it rather than being lost'
);

select is(
  (select ec.status from private.email_contacts ec
   where ec.email_normalized = 'jess@example.com'),
  'pending',
  'and a pending contact stays pending: nothing is sent to an address this identity has not verified'
);

-- ---------------------------------------------------------------------------
-- Round 1: `linkIdentity` is the ordinary path, and the caller must have signed in.
-- ---------------------------------------------------------------------------
select pg_temp.make_user('95000000-0000-0000-0000-0000000000f7'::uuid, 'Linked In Place');

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-0000000000f7',
                        '95000000-0000-0000-0000-0000000000f7', 'settings')),
  0,
  'claiming with one identity on both sides merges nothing and is not an error'
);

select ok(
  (select p.is_permanent from public.profiles p
   where p.user_id = '95000000-0000-0000-0000-0000000000f7'),
  'and still records the saved place, which is the whole point of the call'
);

select pg_temp.make_user('95000000-0000-0000-0000-0000000000f8'::uuid, 'Still A Guest', true);
select throws_ok(
  $$ select * from public.claim_identity('95000000-0000-0000-0000-0000000000f8',
                                  '95000000-0000-0000-0000-0000000000f8', 'settings') $$,
  'destination_is_not_permanent',
  'an anonymous caller cannot mark itself permanent — that would lock it out of its own way back in'
);

select ok(
  not (select p.is_permanent from public.profiles p
       where p.user_id = '95000000-0000-0000-0000-0000000000f8'),
  'and its profile is untouched'
);

-- ---------------------------------------------------------------------------
-- Round 2: a JWT outlives the event it describes.
--
-- `linkIdentity` converts the user in place, so an access token issued minutes
-- earlier keeps `is_anonymous: true` for the rest of its hour while `auth.users`
-- and `profiles` have already moved on. For that hour the stale token was enough
-- to take a second guest membership and attach it to a saved place, where
-- Continue-as can never move it again.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select pg_temp.make_user('95000000-0000-0000-0000-00000000a101'::uuid, 'Just Linked', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000a102'::uuid, 'Someone Else', true);

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000a102', 'Tom on his laptop');

-- What `linkIdentity` leaves behind: the durable records say permanent, and the
-- token in the caller's hand still says otherwise.
update auth.users set is_anonymous = false
where id = '95000000-0000-0000-0000-00000000a101';
update public.profiles set is_permanent = true
where user_id = '95000000-0000-0000-0000-00000000a101';

select pg_temp.act_as('95000000-0000-0000-0000-00000000a101', true);

select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-00000000a102') $$,
  'caller_is_permanent',
  'a stale anonymous claim does not make a saved-place caller a guest again'
);

-- ---------------------------------------------------------------------------
-- Round 2: the account may hold a membership of this circle that *ended*.
--
-- Treating that as a collision removed the guest's live membership and
-- `on_member_removed` deleted the availability they had just submitted. Saving
-- your place cost you the circle.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select pg_temp.make_user('95000000-0000-0000-0000-00000000b101'::uuid, 'Sam Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000b102'::uuid, 'Sam Saved');

-- The account was in this circle once and left.
insert into public.circle_members (circle_id, user_id, display_name_snapshot, status)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000b102', 'Sam from before', 'removed');

-- And is back as a guest, with an answer already given.
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000b101', 'Sam');
insert into public.plan_responses (plan_id, revision, user_id, status)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-00000000b101', 'flexible');

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-00000000b102',
                        '95000000-0000-0000-0000-00000000b101', 'after_answer')),
  1,
  'the live membership moves across rather than being treated as a duplicate'
);

select is(
  (select m.status from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '95000000-0000-0000-0000-00000000b102'),
  'active',
  'and the person is an active member, not a removed one'
);

select is(
  (select count(*)::integer from public.plan_responses r
   where r.plan_id = pg_temp.plan_id()
     and r.user_id = '95000000-0000-0000-0000-00000000b102'),
  1,
  'with the availability they submitted a moment ago still there (spec §5.1)'
);

select is(
  (select m.display_name_snapshot from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '95000000-0000-0000-0000-00000000b102'),
  'Sam',
  'under the name the circle knows them by now, not the one on the old row'
);

-- ---------------------------------------------------------------------------
-- Round 2: the roster read is limited per caller.
--
-- The grant to `authenticated` is not a volume control — one anonymous session
-- can ask about any number of short codes — and the comment used to claim it was.
-- ---------------------------------------------------------------------------
-- A loop, not `generate_series … lateral f(constant)`: the planner evaluates a
-- set-returning function whose arguments do not vary **once**, so the obvious
-- form of this test called the function a single time and then asserted happily
-- that the thirty-first call was refused. It was the first.
select pg_temp.act_as_postgres();
create or replace function pg_temp.lookups(p_times integer, p_code text)
returns integer
language plpgsql
as $$
declare
  i integer;
begin
  for i in 1..p_times loop
    perform 1 from public.guest_members_for_reattach(p_code);
  end loop;
  return p_times;
end;
$$;

select pg_temp.act_as('95000000-0000-0000-0000-00000000a102', true);

select is(
  pg_temp.lookups(30, 'zzzzzzzzzz'),
  30,
  'thirty lookups in an hour are fine — far more than opening a link needs'
);

select throws_ok(
  $$ select public.guest_members_for_reattach('zzzzzzzzzz') $$,
  'too_many_requests',
  'the thirty-first is refused, whether it comes through the client or the RPC'
);

-- ---------------------------------------------------------------------------
-- Round 3: the answer the duplicate gave.
--
-- One person, two devices, two memberships in one circle (spec §9). The saved
-- place survives and the guest row goes — but an answer the guest gave and the
-- survivor never did is an answer this person really made, and
-- `on_member_removed` deletes a removed member's availability (spec §4.5). So it
-- is adopted before the row goes, not lost with it.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select pg_temp.make_user('95000000-0000-0000-0000-00000000c101'::uuid, 'Twice Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000c102'::uuid, 'Twice Saved');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000c101', 'Alex on the bus'),
       (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000c102', 'Alex');

-- Only the guest device answered, was listed as a participant, and said it was
-- interested.
insert into public.plan_responses (plan_id, revision, user_id, status)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-00000000c101', 'flexible');
insert into public.plan_participants (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-00000000c101')
on conflict do nothing;
insert into private.plan_interest (plan_id, user_id, response)
values (pg_temp.plan_id(), '95000000-0000-0000-0000-00000000c101', 'keen');

create temporary table twice_claim as
select * from public.claim_identity('95000000-0000-0000-0000-00000000c102',
                                    '95000000-0000-0000-0000-00000000c101', 'settings');

select is(
  (select merged_memberships from twice_claim),
  0,
  'the duplicate is reconciled rather than moved: the survivor is already here'
);

select is(
  (select duplicates_removed from twice_claim),
  1,
  'and it is reported, so the client can emit `duplicate_member_removed`'
);

select is(
  (select m.status from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '95000000-0000-0000-0000-00000000c101'),
  'removed',
  'the duplicate membership goes, as spec §9 says it should'
);

select is(
  (select count(*)::integer from public.plan_responses r
   where r.plan_id = pg_temp.plan_id()
     and r.user_id = '95000000-0000-0000-0000-00000000c102'),
  1,
  'and the answer only the duplicate had given is the survivor''s now'
);

-- Round 6: and everything else the duplicate alone had. An answer whose owner is
-- not a participant of the revision cannot be edited and is not counted as a
-- reply; an interest answer left behind would count this person twice towards a
-- quiet ask's threshold, which is the one number it turns on.
-- And the count the client needs: `duplicate_member_removed` is in the analytics
-- catalogue and nothing could produce it, because the removal emits the ordinary
-- `circles.member_removed`, which does not say why. Only this function knows.
select is(
  (select duplicates_removed from public.claim_identity(
     '95000000-0000-0000-0000-00000000c102', '95000000-0000-0000-0000-00000000c101', 'settings')),
  0,
  'asked again, there is no duplicate left to report'
);

select is(
  (select count(*)::integer from public.plan_participants pp
   where pp.plan_id = pg_temp.plan_id()
     and pp.user_id = '95000000-0000-0000-0000-00000000c102'),
  1,
  'the survivor is a participant of the revision, so the answer it just adopted is theirs to edit'
);

select is(
  (select count(*)::integer from public.plan_participants pp
   where pp.plan_id = pg_temp.plan_id()
     and pp.user_id = '95000000-0000-0000-0000-00000000c101'),
  0,
  'and the retired identity is not one'
);

select is(
  (select count(*)::integer from private.plan_interest i
   where i.plan_id = pg_temp.plan_id()
     and i.user_id = '95000000-0000-0000-0000-00000000c102'),
  1,
  'the interest answer came across too'
);

select is(
  (select count(*)::integer from private.plan_interest i
   where i.plan_id = pg_temp.plan_id()
     and i.user_id = '95000000-0000-0000-0000-00000000c101'),
  0,
  'rather than being counted a second time under an identity nobody can sign in as'
);

-- ---------------------------------------------------------------------------
-- Round 3: what hangs off a shared address, on the branch where the membership
-- actually moves.
--
-- The account was in this circle, subscribed to the plan at its address, and
-- left. The same person is back as a guest, subscribed to the same plan at the
-- same address, with a message already queued. The contact merge has to reconcile
-- both: `email_subscriptions_one_per_plan_idx` is on `(contact_id, scope,
-- plan_id)`, and `notification_jobs_contact_fkey` is `on delete cascade`.
-- ---------------------------------------------------------------------------
select pg_temp.make_user('95000000-0000-0000-0000-00000000d201'::uuid, 'Nic Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000d202'::uuid, 'Nic Saved');

insert into public.circle_members (circle_id, user_id, display_name_snapshot, status)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000d202', 'Nic from before', 'removed');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000d201', 'Nic');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-00000000d201', 'nic@example.com'),
       ('95000000-0000-0000-0000-00000000d202', 'nic@example.com');

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts ec where ec.email_normalized = 'nic@example.com';

insert into jobs.notification_jobs (channel, kind, contact_id, plan_id, plan_revision,
  scheduled_for, idempotency_key)
select 'email', 'locked_in', ec.id, pg_temp.plan_id(), 1, now(), repeat('d', 64)
from private.email_contacts ec
where ec.email_normalized = 'nic@example.com'
  and ec.user_id = '95000000-0000-0000-0000-00000000d201';

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-00000000d202',
                        '95000000-0000-0000-0000-00000000d201', 'settings')),
  1,
  'two consents to one plan at one address do not roll the whole claim back'
);

select is(
  (select count(*)::integer from private.email_contacts ec
   where ec.email_normalized = 'nic@example.com'),
  1,
  'one contact for the address'
);

select is(
  (select count(*)::integer from private.email_subscriptions sub
   join private.email_contacts ec on ec.id = sub.contact_id
   where ec.email_normalized = 'nic@example.com' and sub.plan_id = pg_temp.plan_id()),
  1,
  'and one consent for the plan, rather than a unique violation'
);

select is(
  (select job.contact_id from jobs.notification_jobs job
   where job.idempotency_key = repeat('d', 64)),
  (select ec.id from private.email_contacts ec where ec.email_normalized = 'nic@example.com'),
  'the queued message was re-pointed, not cascaded away — an email job has no user_id to follow'
);

select is(
  (select count(*)::integer from jobs.notification_jobs job
   where job.idempotency_key = repeat('d', 64)),
  1,
  'so somebody waiting for "locked in" still gets it'
);

-- ---------------------------------------------------------------------------
-- Round 4: attendance follows the person.
--
-- The test this file should have had from the start. `move_membership` updated
-- `attendance.user_id`, and `enforce_attendance_transition` returned `old` for
-- any update that left `status` alone — so the move was discarded in silence and
-- "5 going" went on counting an identity nobody can sign in as.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select pg_temp.make_user('95000000-0000-0000-0000-00000000e301'::uuid, 'Going Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000e302'::uuid, 'New Device', true);

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000e301', 'Jules');
insert into public.plan_participants (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-00000000e301')
on conflict do nothing;

insert into public.meetup_confirmations (plan_id, revision, candidate_id, starts_at, ends_at,
  available_user_ids, confirmed_by)
select pg_temp.plan_id(), 1, c.id, c.starts_at, c.ends_at,
       array['95000000-0000-0000-0000-00000000e301'::uuid],
       '95000000-0000-0000-0000-000000000001'
from public.candidates c
join public.candidate_sets cs on cs.id = c.candidate_set_id
where cs.plan_id = pg_temp.plan_id()
limit 1;

create or replace function pg_temp.confirmation_id() returns uuid
language sql security definer as $$
  select id from public.meetup_confirmations where plan_id = pg_temp.plan_id() limit 1;
$$;

insert into public.attendance (confirmation_id, user_id, status)
values (pg_temp.confirmation_id(), '95000000-0000-0000-0000-00000000e301', 'going');

create temporary table attendance_before as
select updated_at from public.attendance
where confirmation_id = pg_temp.confirmation_id()
  and user_id = '95000000-0000-0000-0000-00000000e301';

delete from jobs.outbox where event_name = 'confirmation.attendance_updated';

select pg_temp.act_as('95000000-0000-0000-0000-00000000e302', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-00000000e301') $$,
  'the guest comes back on a new device'
);

select pg_temp.act_as_postgres();

select is(
  (select a.user_id from public.attendance a
   where a.confirmation_id = pg_temp.confirmation_id()),
  '95000000-0000-0000-0000-00000000e302'::uuid,
  'and their "going" came with them, rather than staying with an identity nobody can sign in as'
);

select is(
  (select a.status from public.attendance a
   where a.confirmation_id = pg_temp.confirmation_id()),
  'going',
  'unchanged, because an identity move is not a change of mind'
);

select is(
  (select a.updated_at from public.attendance a
   where a.confirmation_id = pg_temp.confirmation_id()),
  (select updated_at from attendance_before),
  'and `updated_at` did not move: the confirmed screen orders by it'
);

select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'confirmation.attendance_updated'),
  0,
  'nor was anything announced — nobody''s attendance changed'
);

-- The same answer twice is still a no-op, which is what the old branch was for.
insert into public.attendance (confirmation_id, user_id, status)
values (pg_temp.confirmation_id(), '95000000-0000-0000-0000-00000000e302', 'going')
on conflict (confirmation_id, user_id) do update set status = 'going';

select is(
  (select a.updated_at from public.attendance a
   where a.confirmation_id = pg_temp.confirmation_id()),
  (select updated_at from attendance_before),
  'answering "going" again still changes nothing at all'
);

-- ---------------------------------------------------------------------------
-- Round 4: one address, two circles.
--
-- A contact belongs to an identity, and an identity can be in several circles.
-- Moving the contact whole carried the *other* circle's consent to an identity
-- that is not a member of it.
-- ---------------------------------------------------------------------------
select pg_temp.make_user('95000000-0000-0000-0000-00000000f401'::uuid, 'Two Circles');
select pg_temp.make_user('95000000-0000-0000-0000-00000000f402'::uuid, 'Elsewhere Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-00000000f403'::uuid, 'Elsewhere Device', true);

select pg_temp.act_as('95000000-0000-0000-0000-00000000f401');
create temporary table other_fixture as
select id as circle_id from public.create_circle('Other Crew', '#336699', 'Australia/Melbourne', 'uth-1');

select pg_temp.act_as_postgres();
create or replace function pg_temp.other_circle() returns uuid
language sql security definer as $$ select circle_id from other_fixture $$;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
values (pg_temp.other_circle(), 'named', 'collecting',
        '95000000-0000-0000-0000-00000000f401', 'Other catch up', 'Australia/Melbourne',
        date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
        timestamptz '2099-09-20T10:00:00Z', 'uthpen');

-- One guest identity, in both circles, reachable at one address.
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-00000000f402', 'Kit'),
       (pg_temp.other_circle(), '95000000-0000-0000-0000-00000000f402', 'Kit');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-00000000f402', 'kit@example.com');

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts ec where ec.email_normalized = 'kit@example.com';

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pl.id, 'v1'
from private.email_contacts ec, public.plans pl
where ec.email_normalized = 'kit@example.com' and pl.short_code = 'uthpen';

select pg_temp.act_as('95000000-0000-0000-0000-00000000f403', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-00000000f402') $$,
  'reattaching in one circle succeeds'
);

select pg_temp.act_as_postgres();

-- Scoped by address: earlier sections in this file have left their own
-- subscriptions on this plan.
select is(
  (select sub.user_id from private.email_subscriptions sub
   join private.email_contacts ec on ec.id = sub.contact_id
   where sub.plan_id = pg_temp.plan_id() and ec.email_normalized = 'kit@example.com'),
  '95000000-0000-0000-0000-00000000f403'::uuid,
  'this circle''s consent moved to the returning identity'
);

select is(
  (select sub.user_id from private.email_subscriptions sub
   join public.plans pl on pl.id = sub.plan_id
   where pl.short_code = 'uthpen'),
  '95000000-0000-0000-0000-00000000f402'::uuid,
  'and the other circle''s did not: it belongs to a membership this reattachment never touched'
);

select is(
  (select count(*)::integer from private.email_contacts ec
   where ec.email_normalized = 'kit@example.com'),
  2,
  'the contact was split rather than moved — two identities, one address, which 0009 made legal'
);

-- ---------------------------------------------------------------------------
-- Round 5: the merge branch is scoped too.
--
-- The destination already holds the address *and* the guest's contact carries
-- another circle's consent. The merge used to move everything onto the
-- destination's contact, handing that other circle's consent to an identity that
-- is not a member of it.
--
-- Shown through `reattach_member`, which moves one membership. `claim_identity`
-- moves every circle the identity is in, so it cannot tell this apart.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select pg_temp.make_user('95000000-0000-0000-0000-0000000a5101'::uuid, 'Both Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000a5102'::uuid, 'Both Devices', true);

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000a5101', 'Rae'),
       (pg_temp.other_circle(), '95000000-0000-0000-0000-0000000a5101', 'Rae');

-- Both identities hold the address, and the guest is consented in both circles.
insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000a5101', 'rae@example.com'),
       ('95000000-0000-0000-0000-0000000a5102', 'rae@example.com');

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts ec
where ec.email_normalized = 'rae@example.com'
  and ec.user_id = '95000000-0000-0000-0000-0000000a5101';

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pl.id, 'v1'
from private.email_contacts ec, public.plans pl
where ec.email_normalized = 'rae@example.com'
  and ec.user_id = '95000000-0000-0000-0000-0000000a5101'
  and pl.short_code = 'uthpen';

select pg_temp.act_as('95000000-0000-0000-0000-0000000a5102', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000a5101') $$,
  'the membership moves even with a contact on both sides and consent elsewhere'
);

select pg_temp.act_as_postgres();

select is(
  (select sub.user_id from private.email_subscriptions sub
   join private.email_contacts ec on ec.id = sub.contact_id
   where sub.plan_id = pg_temp.plan_id() and ec.email_normalized = 'rae@example.com'),
  '95000000-0000-0000-0000-0000000a5102'::uuid,
  'this circle''s consent is the returning identity''s now'
);

select is(
  (select sub.user_id from private.email_subscriptions sub
   join private.email_contacts ec on ec.id = sub.contact_id
   join public.plans pl on pl.id = sub.plan_id
   where pl.short_code = 'uthpen' and ec.email_normalized = 'rae@example.com'),
  '95000000-0000-0000-0000-0000000a5101'::uuid,
  'and the other circle''s is untouched, on a contact that was not merged away'
);

select is(
  (select count(*)::integer from private.email_contacts ec
   where ec.email_normalized = 'rae@example.com'),
  2,
  'so the guest''s contact survives: it still holds a circle this move never touched'
);

-- ---------------------------------------------------------------------------
-- Round 5: being required follows the person through a duplicate merge.
--
-- `on_member_removed` leaves `plan_required_members` alone on purpose — spec §9
-- makes a required person leaving the organiser's problem — but nobody leaves
-- here, so an active plan would have gone on requiring an identity that could no
-- longer answer, and never produced an eligible candidate.
-- ---------------------------------------------------------------------------
select pg_temp.make_user('95000000-0000-0000-0000-0000000a6101'::uuid, 'Needed Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000a6102'::uuid, 'Needed Saved');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000a6101', 'Fran on her phone'),
       (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000a6102', 'Fran');

insert into public.plan_required_members (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000a6101');

select is(
  (select merged_memberships from public.claim_identity('95000000-0000-0000-0000-0000000a6102',
                        '95000000-0000-0000-0000-0000000a6101', 'settings')),
  0,
  'the duplicate is reconciled'
);

select is(
  (select count(*)::integer from public.plan_required_members rm
   where rm.plan_id = pg_temp.plan_id()
     and rm.user_id = '95000000-0000-0000-0000-0000000a6102'),
  1,
  'and the organiser''s "this person has to be there" follows them'
);

select is(
  (select count(*)::integer from public.plan_required_members rm
   where rm.plan_id = pg_temp.plan_id()
     and rm.user_id = '95000000-0000-0000-0000-0000000a6101'),
  0,
  'rather than staying on an identity that can no longer answer'
);

-- ---------------------------------------------------------------------------
-- Round 8: three things about an address that has already been written to.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

-- (a) An emailed link whose membership has since become a saved place is not a
--     broken link. §10: "the page offers that identity's sign-in instead" — which
--     the client can only do if it is told which of the two happened. Deleting the
--     token made every such link answer `token_invalid`.
select pg_temp.make_user('95000000-0000-0000-0000-0000000b7101'::uuid, 'Linked Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000b7102'::uuid, 'Linked Account');
select pg_temp.make_user('95000000-0000-0000-0000-0000000b7103'::uuid, 'A Third Device', true);

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000b7101', 'Mo');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000b7101', 'mo@example.com');

insert into private.email_action_tokens (
  contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
)
select ec.id, 'reentry', extensions.digest('mo-reentry', 'sha256'),
       now() + interval '7 days', pg_temp.circle_id(), '95000000-0000-0000-0000-0000000b7101'
from private.email_contacts ec where ec.email_normalized = 'mo@example.com';

select is(
  (select merged_memberships from public.claim_identity(
     '95000000-0000-0000-0000-0000000b7102', '95000000-0000-0000-0000-0000000b7101', 'settings')),
  1,
  'saving a place with an outstanding re-entry link succeeds'
);

select isnt_empty(
  $$ select 1 from private.email_action_tokens
     where token_hash = extensions.digest('mo-reentry', 'sha256') $$,
  'and the link is still on record rather than deleted'
);

select isnt_empty(
  $$ select 1 from private.email_action_tokens
     where token_hash = extensions.digest('mo-reentry', 'sha256') and used_at is not null $$,
  'spent, so it is no longer a way in without signing in'
);

select pg_temp.act_as('95000000-0000-0000-0000-0000000b7103', true);
select throws_ok(
  format($$ select public.reattach_member(null, null, %L) $$,
         extensions.digest('mo-reentry', 'sha256')),
  'target_is_permanent',
  'so following it says "this is an account now", not "this link is broken"'
);

-- (b) The duplicate-merge path reconciles the address too. Leaving the contact
--     behind stranded its consent and its links on a membership about to be
--     removed.
select pg_temp.act_as_postgres();
select pg_temp.make_user('95000000-0000-0000-0000-0000000b8101'::uuid, 'Dup Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000b8102'::uuid, 'Dup Account');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000b8101', 'Ash on the train'),
       (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000b8102', 'Ash');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000b8101', 'ash@example.com');

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts ec where ec.email_normalized = 'ash@example.com';

select is(
  (select duplicates_removed from public.claim_identity(
     '95000000-0000-0000-0000-0000000b8102', '95000000-0000-0000-0000-0000000b8101', 'settings')),
  1,
  'the duplicate is retired'
);

select is(
  (select sub.user_id from private.email_subscriptions sub
   join private.email_contacts ec on ec.id = sub.contact_id
   where ec.email_normalized = 'ash@example.com'),
  '95000000-0000-0000-0000-0000000b8102'::uuid,
  'and its consent went to the membership that survived, not down with the one that did not'
);

-- (c) A withdrawal survives a merge. Choosing the surviving row by identity
--     discarded an unsubscribe, and unsubscribing is immediate here (§14).
select pg_temp.make_user('95000000-0000-0000-0000-0000000b9101'::uuid, 'Quiet Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000b9102'::uuid, 'Quiet Account');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000b9101', 'Bo');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000b9101', 'bo@example.com'),
       ('95000000-0000-0000-0000-0000000b9102', 'bo@example.com');

-- The guest unsubscribed; the account never did.
insert into private.email_subscriptions
  (contact_id, user_id, scope, plan_id, consent_text_version, status, withdrawn_at)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1', 'withdrawn', now()
from private.email_contacts ec
where ec.email_normalized = 'bo@example.com'
  and ec.user_id = '95000000-0000-0000-0000-0000000b9101';

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts ec
where ec.email_normalized = 'bo@example.com'
  and ec.user_id = '95000000-0000-0000-0000-0000000b9102';

select is(
  (select merged_memberships from public.claim_identity(
     '95000000-0000-0000-0000-0000000b9102', '95000000-0000-0000-0000-0000000b9101', 'settings')),
  1,
  'the membership moves'
);

select is(
  (select sub.status from private.email_subscriptions sub
   join private.email_contacts ec on ec.id = sub.contact_id
   where ec.email_normalized = 'bo@example.com' and sub.plan_id = pg_temp.plan_id()),
  'withdrawn',
  'and the surviving consent is withdrawn: a merge is not a way to undo an unsubscribe'
);

select isnt_empty(
  $$ select 1 from private.email_subscriptions sub
     join private.email_contacts ec on ec.id = sub.contact_id
     where ec.email_normalized = 'bo@example.com' and sub.withdrawn_at is not null $$,
  'with the time it happened still recorded'
);

-- ---------------------------------------------------------------------------
-- Round 10: three ways the merge and the reattachment gave away more than asked.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

-- (a) Naming yourself as the target used to answer before checking anything, so
--     any session that knew a circle's uuid was handed the circle — the name, the
--     colour, the zone, the short code — which RLS refuses and §9.4 deliberately
--     narrows to the name alone. It was an existence oracle over uuids too.
select pg_temp.make_user('95000000-0000-0000-0000-0000000c1101'::uuid, 'Total Stranger', true);
select pg_temp.act_as('95000000-0000-0000-0000-0000000c1101', true);

select is_empty(
  format($$ select 1 from public.circles where id = %L $$, pg_temp.circle_id()),
  'a stranger reads nothing of this circle through RLS'
);

select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '95000000-0000-0000-0000-0000000c1101') $$,
  'member_not_found',
  'and nothing through reattach_member by naming themselves, either'
);

-- (b) A duplicate merge with an unspent emailed link outstanding. The token's
--     composite foreign key is deferred, so this failed *at commit* — which a
--     suite that always rolls back could never see. Hence `set constraints all
--     immediate` at the end of this file.
select pg_temp.act_as_postgres();
select pg_temp.make_user('95000000-0000-0000-0000-0000000c2101'::uuid, 'Emailed Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000c2102'::uuid, 'Emailed Account');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000c2101', 'Ira on the phone'),
       (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000c2102', 'Ira');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000c2101', 'ira@example.com');

insert into private.email_action_tokens (
  contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
)
select ec.id, 'reentry', extensions.digest('ira-reentry', 'sha256'),
       now() + interval '7 days', pg_temp.circle_id(), '95000000-0000-0000-0000-0000000c2101'
from private.email_contacts ec where ec.email_normalized = 'ira@example.com';

select is(
  (select duplicates_removed from public.claim_identity(
     '95000000-0000-0000-0000-0000000c2102', '95000000-0000-0000-0000-0000000c2101', 'settings')),
  1,
  'saving a place works for somebody who had asked to be emailed'
);

select isnt_empty(
  $$ select 1 from private.email_action_tokens
     where token_hash = extensions.digest('ira-reentry', 'sha256') and used_at is not null $$,
  'their outstanding link is spent, so it is no longer a way in without signing in'
);

select is(
  (select membership_user_id from private.email_action_tokens
   where token_hash = extensions.digest('ira-reentry', 'sha256')),
  '95000000-0000-0000-0000-0000000c2102'::uuid,
  'and bound to the membership that survived, not the one that was retired'
);

-- (c) The account was here, left, and came back as a guest — Continue-as cannot
--     list a saved place, so there was no other way back. `on_member_removed`
--     leaves being required and the prompts already shown behind, and both collided
--     with the guest's rows on the primary key.
select pg_temp.make_user('95000000-0000-0000-0000-0000000c3101'::uuid, 'Returned Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000c3102'::uuid, 'Returned Account');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000c3102', 'Lee back then');
insert into public.plan_required_members (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000c3102');
insert into public.nudge_states (user_id, moment, plan_id)
values ('95000000-0000-0000-0000-0000000c3102', 'after_confirmed', pg_temp.plan_id());

-- Removed the way a removal actually happens, so the trigger runs.
update public.circle_members m
set status = 'removed'
where m.circle_id = pg_temp.circle_id() and m.user_id = '95000000-0000-0000-0000-0000000c3102';

select isnt_empty(
  $$ select 1 from public.plan_required_members
     where user_id = '95000000-0000-0000-0000-0000000c3102' $$,
  'the removal left being required behind, as spec §9 intends'
);

-- And back as a guest, required again and prompted again.
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000c3101', 'Lee');
insert into public.plan_required_members (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000c3101');
insert into public.nudge_states (user_id, moment, plan_id)
values ('95000000-0000-0000-0000-0000000c3101', 'after_confirmed', pg_temp.plan_id());

select is(
  (select merged_memberships from public.claim_identity(
     '95000000-0000-0000-0000-0000000c3102', '95000000-0000-0000-0000-0000000c3101', 'settings')),
  1,
  'signing in again succeeds instead of aborting on a primary key'
);

select is(
  (select m.display_name_snapshot from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '95000000-0000-0000-0000-0000000c3102' and m.status = 'active'),
  'Lee',
  'under the name the circle knows them by now'
);

select is(
  (select count(*)::integer from public.plan_required_members rm
   where rm.plan_id = pg_temp.plan_id()
     and rm.user_id = '95000000-0000-0000-0000-0000000c3102'),
  1,
  'with one required-member row, not the two that used to collide'
);

select is(
  (select count(*)::integer from public.nudge_states n
   where n.plan_id = pg_temp.plan_id()
     and n.user_id = '95000000-0000-0000-0000-0000000c3102'
     and n.moment = 'after_confirmed'),
  1,
  'and one record of the prompt they have been shown'
);

-- ---------------------------------------------------------------------------
-- Round 11: a link with no membership, history that collides with nothing, and a
-- link burned for nothing.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

-- (a) A `verify` or `prefs` token names no membership — the constraint requires
--     null — and `null is distinct from <uuid>` is true, so every contact with a
--     verification link outstanding looked like a contact tied to another circle and
--     was split: consent on a copy with no links, links on an identity with no
--     consent.
select pg_temp.make_user('95000000-0000-0000-0000-0000000d1101'::uuid, 'Verify Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000d1102'::uuid, 'Verify Account');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000d1101', 'Van');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000d1101', 'van@example.com');

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select ec.id, ec.user_id, 'plan_updates', pg_temp.plan_id(), 'v1'
from private.email_contacts ec where ec.email_normalized = 'van@example.com';

insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
select ec.id, 'verify', extensions.digest('van-verify', 'sha256'), now() + interval '7 days'
from private.email_contacts ec where ec.email_normalized = 'van@example.com';

insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
select ec.id, 'prefs', extensions.digest('van-prefs', 'sha256'), now() + interval '7 days'
from private.email_contacts ec where ec.email_normalized = 'van@example.com';

select is(
  (select merged_memberships from public.claim_identity(
     '95000000-0000-0000-0000-0000000d1102', '95000000-0000-0000-0000-0000000d1101', 'settings')),
  1,
  'the membership moves with a verification link outstanding'
);

select is(
  (select count(*)::integer from private.email_contacts ec
   where ec.email_normalized = 'van@example.com'),
  1,
  'and the contact travelled rather than being split in two'
);

select is(
  (select ec.user_id from private.email_contacts ec
   where ec.email_normalized = 'van@example.com'),
  '95000000-0000-0000-0000-0000000d1102'::uuid,
  'onto the identity that now holds the membership'
);

select is(
  (select count(*)::integer from private.email_action_tokens t
   join private.email_contacts ec on ec.id = t.contact_id
   where ec.email_normalized = 'van@example.com'
     and t.purpose in ('verify', 'prefs')
     and t.used_at is null),
  2,
  'with both emailed links still live and still addressing the contact that holds the consent'
);

select isnt_empty(
  $$ select 1 from private.email_subscriptions sub
     join private.email_contacts ec on ec.id = sub.contact_id
     where ec.email_normalized = 'van@example.com' $$,
  'which is the same contact the consent is on — "verify" and "manage preferences" both work (spec §5.8)'
);

-- (b) History that collides with nothing stays. Spec §4.5 lets a removed member's
--     historic attendance remain, and `on_member_removed` keeps a past `was_there`
--     on purpose; clearing the lot threw away the record that somebody turned up.
select pg_temp.make_user('95000000-0000-0000-0000-0000000d2101'::uuid, 'History Guest', true);
select pg_temp.make_user('95000000-0000-0000-0000-0000000d2102'::uuid, 'History Account');

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000d2102', 'Kay before');
insert into public.plan_participants (plan_id, revision, user_id)
values (pg_temp.plan_id(), 1, '95000000-0000-0000-0000-0000000d2102')
on conflict do nothing;
insert into public.attendance (confirmation_id, user_id, status)
values (pg_temp.confirmation_id(), '95000000-0000-0000-0000-0000000d2102', 'going');

-- The meetup has happened and been reported on. Not incidental: `on_member_removed`
-- rewrites a `going` to `cant` only on a confirmation that is still `active` and
-- still ahead, and it deletes the participant row first — so removing a member who
-- is "going" to something ahead raises `attendance_not_a_participant` and fails
-- outright. That is a defect in shipped code (0004 and 0005 together), not in this
-- change; it is written up on its own ticket, and this fixture stays clear of it.
update public.meetup_confirmations c
set status = 'completed', superseded_at = now(), superseded_reason = 'outcome'
where c.id = pg_temp.confirmation_id();

update public.circle_members m set status = 'removed'
where m.circle_id = pg_temp.circle_id() and m.user_id = '95000000-0000-0000-0000-0000000d2102';

-- Back as a guest, with nothing on that confirmation of their own.
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000d2101', 'Kay');

select is(
  (select merged_memberships from public.claim_identity(
     '95000000-0000-0000-0000-0000000d2102', '95000000-0000-0000-0000-0000000d2101', 'settings')),
  1,
  'signing in again succeeds'
);

select isnt_empty(
  $$ select 1 from public.attendance a
     where a.confirmation_id = pg_temp.confirmation_id()
       and a.user_id = '95000000-0000-0000-0000-0000000d2102' $$,
  'and the attendance nothing collided with is still there — it is the record that somebody turned up'
);

-- (c) And a link is not burned for a no-op. Somebody who follows their own emailed
--     link while the session still works gets "already theirs" — and used to lose
--     the link they would need when it stopped working.
select pg_temp.make_user('95000000-0000-0000-0000-0000000d3101'::uuid, 'Self Link', true);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '95000000-0000-0000-0000-0000000d3101', 'Ros');

insert into private.email_contacts (user_id, email_normalized)
values ('95000000-0000-0000-0000-0000000d3101', 'ros@example.com');
insert into private.email_action_tokens (
  contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
)
select ec.id, 'reentry', extensions.digest('ros-reentry', 'sha256'),
       now() + interval '7 days', pg_temp.circle_id(), '95000000-0000-0000-0000-0000000d3101'
from private.email_contacts ec where ec.email_normalized = 'ros@example.com';

select pg_temp.act_as('95000000-0000-0000-0000-0000000d3101', true);
select lives_ok(
  format($$ select public.reattach_member(null, null, %L) $$,
         extensions.digest('ros-reentry', 'sha256')),
  'following your own link while still signed in is answered, not refused'
);

select pg_temp.act_as_postgres();
select isnt_empty(
  $$ select 1 from private.email_action_tokens
     where token_hash = extensions.digest('ros-reentry', 'sha256') and used_at is null $$,
  'and the link is still unspent, for the day the session stops working'
);

create or replace function pg_temp.writes_to(p_function text, p_table text)
returns boolean
language sql
as $$
  -- Comments stripped first. Round 10 changed this from "the name appears" to "a
  -- write appears" and left it reading the raw body, so `-- delete from
  -- private.plan_interest …` satisfied it: a statement commented out was
  -- indistinguishable from a statement. An outright deletion was caught; the one
  -- edit somebody is most likely to make while debugging was not.
  select regexp_replace(
           regexp_replace(pg_get_functiondef(p_function::regprocedure), '--[^\n]*', '', 'g'),
           '/\*.*?\*/', '', 'gs'
         ) ~*
    -- `public.` is optional because `regclass::text` drops it for tables on the
    -- search path, while the function bodies always qualify (`set search_path = ''`
    -- leaves them no choice). Dots in a qualified name are escaped so that
    -- `private.plan_interest` cannot be matched by anything else.
    ('(update|delete[[:space:]]+from)[[:space:]]+(public\.)?'
      || replace(p_table, '.', '\.') || '[[:space:]]');
$$;

-- (d) The guard itself: a write that is only a comment is not a write.
create or replace function pg_temp.only_a_comment()
returns void
language plpgsql
as $$
begin
  -- delete from public.nudge_states n where false;
  return;
end;
$$;

select ok(
  not pg_temp.writes_to('pg_temp.only_a_comment()', 'nudge_states'),
  'a commented-out statement does not satisfy the completeness guard'
);

select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- The list of tables a membership owns will rot. This is the guard that makes
-- it rot loudly: every table that points at an identity is either moved by
-- `move_membership` or named here as one that deliberately stays.
-- ---------------------------------------------------------------------------
create temporary table identity_tables (name text primary key, moves boolean);

insert into identity_tables (name, moves) values
  -- Moved: rows a member owns inside one circle.
  ('circle_members', true),
  ('plan_responses', true),
  ('plan_participants', true),
  ('plan_required_members', true),
  ('attendance', true),
  ('nudge_states', true),
  ('private.plan_interest', true),
  ('private.email_contacts', true),
  ('jobs.notification_jobs', true),
  -- Stays: a record of something that happened, or a role a guest cannot hold.
  ('private.email_subscriptions', false),   -- follows email_contacts by cascade
  ('private.push_devices', false),          -- a device, not a membership
  ('private.plan_initiators', false),       -- initiating needs a saved place (ADR 0004)
  ('profiles', false),                      -- the identity itself
  ('circles', false),                       -- owning needs a saved place (ADR 0004)
  ('circle_invites', false),                -- created_by: who issued it, historically
  ('plans', false),                         -- organising needs a saved place (ADR 0004)
  ('meetup_confirmations', false),          -- confirmed_by: who decided, historically
  ('outcome_reports', false),               -- reported_by: who said so, historically
  -- A request one identity already made and was already answered. The answer
  -- went to that session; a new identity has made no requests yet.
  ('jobs.idempotent_requests', false);

select bag_eq(
  $$ select distinct con.conrelid::regclass::text
     from pg_constraint con
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and con.conrelid::regclass::text not like 'auth.%' $$,
  $$ select name from identity_tables $$,
  'every table referencing an identity is classified as moving or staying'
);

-- Matched as a *statement*, not as a substring. `position(name in definition)` was
-- satisfied by the table being mentioned in a comment, or keyed some other way —
-- `jobs.notification_jobs` passed that way while nothing updated it by user id. A
-- table is handled when something writes to it.
select bag_eq(
  $$ select name from identity_tables where moves
     and not pg_temp.writes_to('private.move_membership(uuid, uuid, uuid)', name)
     and not pg_temp.writes_to('private.reconcile_contacts(uuid, uuid, uuid)', name) $$,
  $$ select null::text where false $$,
  'and each one that moves is written to by move_membership, or by the contact reconciliation it delegates to'
);

-- There are two movers now, and the second one is the gap-filler
-- `adopt_membership_rows`. They will drift unless something says they must not:
-- a table the unconditional move handles and the duplicate merge forgets is the
-- bug of round 6, where the answer came across and the participation did not.
--
-- Read against the adopter *and* `reconcile_contacts`, which both movers delegate
-- the address to. Two tables are named as deliberately absent: the membership row
-- itself, which a duplicate merge *removes* rather than moves, and
-- `jobs.notification_jobs`, whose email rows are keyed by contact and re-pointed
-- there (a push row belongs to a saved place, which a duplicate guest is not).
select bag_eq(
  $$ select name from identity_tables where moves
     and name not in ('circle_members', 'jobs.notification_jobs')
     and not pg_temp.writes_to('private.adopt_membership_rows(uuid, uuid, uuid)', name)
     and not pg_temp.writes_to('private.reconcile_contacts(uuid, uuid, uuid)', name) $$,
  $$ select null::text where false $$,
  'and each one is written to by adopt_membership_rows too, or excused here by name'
);

-- And the branch that retires a returning account's old membership clears the same
-- tables, or its rows collide with the guest's on the primary key.
select bag_eq(
  $$ select name from identity_tables where moves
     and name not in ('circle_members', 'jobs.notification_jobs', 'private.email_contacts')
     and not pg_temp.writes_to('private.discard_membership_rows(uuid, uuid, uuid)', name) $$,
  $$ select null::text where false $$,
  'and discard_membership_rows clears every one of them as well'
);

-- Deferred constraints are checked at commit, and this suite rolls back — so a
-- violation of one was invisible here, which is exactly how the re-entry token's
-- composite foreign key got through ten rounds of review. Forcing them now is the
-- only way this file can see them at all.
set constraints all immediate;

select * from finish();
rollback;
