-- Verifying an address promotes only the contacts of the same person (SUS-106,
-- ADR 0049).
--
-- "The same person" is the same `user_id`, or an identity linked to it by a
-- recorded reattachment. Anybody else's pending contact at the address stays
-- pending, so its subscription stays undeliverable.

begin;
select plan(42);

create or replace function pg_temp.make_user(id uuid, name text, permanent boolean default false)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', not permanent,
    jsonb_build_object('is_anonymous', not permanent),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid, anonymous boolean default true) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.hash_of(token text) returns bytea
language sql as $$ select extensions.digest(token, 'sha256') $$;

create or replace function pg_temp.contact_of(addr text, who uuid) returns uuid
language sql security definer as $$
  select c.id from private.email_contacts c
  where c.email_normalized = addr and c.user_id = who
$$;

create or replace function pg_temp.status_of(addr text, who uuid) returns text
language sql security definer as $$
  select c.status from private.email_contacts c
  where c.email_normalized = addr and c.user_id = who
$$;

create or replace function pg_temp.recipients(code text) returns uuid[]
language sql security definer as $$
  select coalesce(array_agg(r.contact_id order by r.contact_id), array[]::uuid[])
  from private.email_recipients_for((select id from public.plans where short_code = code)) r
$$;

create or replace function pg_temp.plan_in(circle uuid, code text, state text default 'collecting')
returns void language sql as $$
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  ) values (
    circle, 'named', state, '30000000-0000-0000-0000-000000000001',
    'Plan ' || code, 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
    1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', code
  );
$$;

create or replace function pg_temp.join(circle uuid, who uuid) returns void
language sql as $$
  insert into public.circle_members (circle_id, user_id, display_name_snapshot)
  values (circle, who, 'Member ' || right(who::text, 3));
$$;

-- Maya owns two circles. A, B, and a few others are guests.
select pg_temp.make_user('30000000-0000-0000-0000-000000000001', 'Maya', true);
select pg_temp.make_user('30000000-0000-0000-0000-0000000000a1', 'A');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000b1', 'B');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000b2', 'B signed in', true);

select pg_temp.act_as('30000000-0000-0000-0000-000000000001', false);
select public.create_circle('Crew One', 'sky', 'Australia/Melbourne', 'sus106-one');
select public.create_circle('Crew Two', 'sky', 'Australia/Melbourne', 'sus106-two');

select pg_temp.act_as_postgres();
create temporary table cs as
select (select id from public.circles where creation_key = 'sus106-one') as c1,
       (select id from public.circles where creation_key = 'sus106-two') as c2;
grant select on cs to anon, authenticated, service_role;
create or replace function pg_temp.c1() returns uuid language sql security definer as $$ select c1 from cs $$;
create or replace function pg_temp.c2() returns uuid language sql security definer as $$ select c2 from cs $$;

select pg_temp.join(pg_temp.c1(), '30000000-0000-0000-0000-0000000000a1');
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000b1');
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000b2');
select pg_temp.plan_in(pg_temp.c1(), 'qqqqpa', 'ready');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqpb');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqpc');

insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '30000000-0000-0000-0000-0000000000a1'::uuid from public.plans where short_code = 'qqqqpa';

-- A's plan is locked in before anything is verified, so a verification that
-- reached A's contact would have a letter to queue for it.
insert into public.candidate_sets (
  plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select p.id, p.revision, p.input_version, p.scoring_version, 'seed', 10, 1, 1, 4
from public.plans p where p.short_code = 'qqqqpa';

insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select cset.id, false, 1, timestamptz '2099-09-18T08:30:00Z', timestamptz '2099-09-18T10:30:00Z',
  array['30000000-0000-0000-0000-0000000000a1'::uuid], 1, 0, 'best_attendance', 1
from public.candidate_sets cset join public.plans p on p.id = cset.plan_id
where p.short_code = 'qqqqpa';

select planning.transition_plan(
  (select id from public.plans where short_code = 'qqqqpa'), 'confirm',
  '30000000-0000-0000-0000-000000000001',
  jsonb_build_object('candidate_id', '2099-09-18T08:30:00+00:00'));

-- ---------------------------------------------------------------------------
-- 1. A asks for updates at an address and never verifies. B, who holds the
--    address, verifies it for B's own plan.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select public.request_email_updates(
  (select id from public.plans where short_code = 'qqqqpa'),
  '30000000-0000-0000-0000-0000000000a1', 'shared@example.com', '2026-09-14', 'r-a');
select public.request_email_updates(
  (select id from public.plans where short_code = 'qqqqpb'),
  '30000000-0000-0000-0000-0000000000b1', 'shared@example.com', '2026-09-14', 'r-b');
select public.issue_verification_token(
  pg_temp.contact_of('shared@example.com', '30000000-0000-0000-0000-0000000000b1'),
  pg_temp.hash_of('t-b'));

select is(
  (select public.verify_email_contact(pg_temp.hash_of('t-b')) -> 'active_plans' -> 0 ->> 'short_code'),
  'qqqqpb',
  'B''s verification answers with B''s own plan'
);

select pg_temp.act_as_postgres();
select is(pg_temp.status_of('shared@example.com', '30000000-0000-0000-0000-0000000000b1'),
  'verified', 'B''s contact is verified');
select is(pg_temp.status_of('shared@example.com', '30000000-0000-0000-0000-0000000000a1'),
  'pending', 'A''s contact at the same address is still pending');
select is(
  (select s.status from private.email_subscriptions s
   where s.contact_id = pg_temp.contact_of('shared@example.com', '30000000-0000-0000-0000-0000000000a1')),
  'active', 'A''s subscription is untouched, the consent as recorded');
select is(pg_temp.recipients('qqqqpa'), array[]::uuid[],
  'nobody is deliverable for A''s plan');
select is(pg_temp.recipients('qqqqpb'),
  array[pg_temp.contact_of('shared@example.com', '30000000-0000-0000-0000-0000000000b1')],
  'B is deliverable for B''s plan');
select is(
  (select count(*)::integer from jobs.notification_jobs j
   where j.contact_id = pg_temp.contact_of('shared@example.com', '30000000-0000-0000-0000-0000000000a1')
     and j.kind = 'locked_in'),
  0, 'no "locked in" letter is queued for A''s contact');

-- Retention removes it as it always has: a pending contact goes after seven
-- days once no verification letter or link for it is outstanding.
delete from jobs.notification_jobs
where contact_id = pg_temp.contact_of('shared@example.com', '30000000-0000-0000-0000-0000000000a1');
delete from private.email_action_tokens
where contact_id = pg_temp.contact_of('shared@example.com', '30000000-0000-0000-0000-0000000000a1');
update private.email_contacts set created_at = now() - interval '8 days'
where id = pg_temp.contact_of('shared@example.com', '30000000-0000-0000-0000-0000000000a1');
select jobs.run_retention();
select is(pg_temp.status_of('shared@example.com', '30000000-0000-0000-0000-0000000000a1'),
  null, 'and retention removes A''s pending contact after its seven days');

-- ---------------------------------------------------------------------------
-- 2. The same, with B signing in with that address (ADR 0027's path).
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update auth.users set email = 'signin@example.com', email_confirmed_at = now()
where id = '30000000-0000-0000-0000-0000000000b2';
select pg_temp.act_as_service();
select public.request_email_updates(
  (select id from public.plans where short_code = 'qqqqpa'),
  '30000000-0000-0000-0000-0000000000a1', 'signin@example.com', '2026-09-14', 'r-a2');
select is(
  public.dispatch_organiser_contact('30000000-0000-0000-0000-0000000000b2'),
  pg_temp.contact_of('signin@example.com', '30000000-0000-0000-0000-0000000000b2'),
  'B signing in with the address has a verified contact of their own');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('signin@example.com', '30000000-0000-0000-0000-0000000000b2'),
  'verified', 'B''s own contact is verified');
select is(pg_temp.status_of('signin@example.com', '30000000-0000-0000-0000-0000000000a1'),
  'pending', 'A''s contact at the same address is still pending');
select is(pg_temp.recipients('qqqqpa'), array[]::uuid[],
  'and nobody is deliverable for A''s plan');

-- The same person's own pending contact at the address is promoted by auth too.
select pg_temp.act_as_service();
select public.request_email_updates(
  (select id from public.plans where short_code = 'qqqqpc'),
  '30000000-0000-0000-0000-0000000000b2', 'own@example.com', '2026-09-14', 'r-b2');
select pg_temp.act_as_postgres();
update auth.users set email = 'own@example.com' where id = '30000000-0000-0000-0000-0000000000b2';
select pg_temp.act_as_service();
select public.dispatch_organiser_contact('30000000-0000-0000-0000-0000000000b2');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('own@example.com', '30000000-0000-0000-0000-0000000000b2'),
  'verified', 'while the same identity''s own pending contact is promoted');

-- ---------------------------------------------------------------------------
-- 3. The split-contact case from the function header. One person, one address,
--    two contacts: the second made by a real reattachment.
-- ---------------------------------------------------------------------------
select pg_temp.make_user('30000000-0000-0000-0000-0000000000c1', 'Split old');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000c2', 'Split new');
select pg_temp.join(pg_temp.c1(), '30000000-0000-0000-0000-0000000000c1');
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000c1');
select pg_temp.plan_in(pg_temp.c1(), 'qqqqpd');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqpe');

select pg_temp.act_as_service();
select public.request_email_updates(
  (select id from public.plans where short_code = 'qqqqpd'),
  '30000000-0000-0000-0000-0000000000c1', 'split@example.com', '2026-09-14', 'r-c1');
select public.request_email_updates(
  (select id from public.plans where short_code = 'qqqqpe'),
  '30000000-0000-0000-0000-0000000000c1', 'split@example.com', '2026-09-14', 'r-c2');
select public.issue_verification_token(
  pg_temp.contact_of('split@example.com', '30000000-0000-0000-0000-0000000000c1'),
  pg_temp.hash_of('t-split-old'));

-- Crew One's membership moves to a new session; Crew Two's stays.
select pg_temp.act_as('30000000-0000-0000-0000-0000000000c2');
select public.reattach_member(pg_temp.c1(), '30000000-0000-0000-0000-0000000000c1');
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_contacts c where c.email_normalized = 'split@example.com'),
  2, 'the reattachment left one person''s address on two contacts');
select is(
  array[pg_temp.status_of('split@example.com', '30000000-0000-0000-0000-0000000000c1'),
        pg_temp.status_of('split@example.com', '30000000-0000-0000-0000-0000000000c2')],
  array['pending', 'pending'], 'both pending');
select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000c1') i),
  array['30000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c2']::uuid[],
  'the reattachment is the recorded link between the two identities');

select pg_temp.act_as_service();
select public.verify_email_contact(pg_temp.hash_of('t-split-old'));
select pg_temp.act_as_postgres();
select is(
  array[pg_temp.status_of('split@example.com', '30000000-0000-0000-0000-0000000000c1'),
        pg_temp.status_of('split@example.com', '30000000-0000-0000-0000-0000000000c2')],
  array['verified', 'verified'], 'verifying on the side left behind ends with both verified');
select is(pg_temp.recipients('qqqqpd'),
  array[pg_temp.contact_of('split@example.com', '30000000-0000-0000-0000-0000000000c2')],
  'and the moved place''s plan is deliverable to the contact that holds it');

-- The other direction: the link names the copy.
select pg_temp.make_user('30000000-0000-0000-0000-0000000000d1', 'Back old');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000d2', 'Back new');
select pg_temp.join(pg_temp.c1(), '30000000-0000-0000-0000-0000000000d1');
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000d1');
select pg_temp.plan_in(pg_temp.c1(), 'qqqqpf');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqpg');
select pg_temp.act_as_service();
select public.request_email_updates((select id from public.plans where short_code = 'qqqqpf'),
  '30000000-0000-0000-0000-0000000000d1', 'back@example.com', '2026-09-14', 'r-d1');
select public.request_email_updates((select id from public.plans where short_code = 'qqqqpg'),
  '30000000-0000-0000-0000-0000000000d1', 'back@example.com', '2026-09-14', 'r-d2');
select pg_temp.act_as('30000000-0000-0000-0000-0000000000d2');
select public.reattach_member(pg_temp.c1(), '30000000-0000-0000-0000-0000000000d1');
select pg_temp.act_as_service();
select public.issue_verification_token(
  pg_temp.contact_of('back@example.com', '30000000-0000-0000-0000-0000000000d2'),
  pg_temp.hash_of('t-back-new'));
select public.verify_email_contact(pg_temp.hash_of('t-back-new'));
select pg_temp.act_as_postgres();
select is(
  array[pg_temp.status_of('back@example.com', '30000000-0000-0000-0000-0000000000d1'),
        pg_temp.status_of('back@example.com', '30000000-0000-0000-0000-0000000000d2')],
  array['verified', 'verified'], 'verifying on the side that was moved to ends with both verified');

select pg_temp.make_user('30000000-0000-0000-0000-0000000000d3', 'Chain one');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000d4', 'Chain two');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000d5', 'Chain three');
select pg_temp.join(pg_temp.c1(), '30000000-0000-0000-0000-0000000000d3');
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000d3');
select pg_temp.plan_in(pg_temp.c1(), 'qqqqpk');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqpm');
select pg_temp.act_as_service();
select public.request_email_updates((select id from public.plans where short_code = 'qqqqpk'),
  '30000000-0000-0000-0000-0000000000d3', 'chain@example.com', '2026-09-14', 'r-d3k');
select public.request_email_updates((select id from public.plans where short_code = 'qqqqpm'),
  '30000000-0000-0000-0000-0000000000d3', 'chain@example.com', '2026-09-14', 'r-d3m');
select public.issue_verification_token(
  pg_temp.contact_of('chain@example.com', '30000000-0000-0000-0000-0000000000d3'),
  pg_temp.hash_of('t-chain'));
select pg_temp.act_as('30000000-0000-0000-0000-0000000000d4');
select public.reattach_member(pg_temp.c1(), '30000000-0000-0000-0000-0000000000d3');
select pg_temp.act_as_postgres();
-- Separate calls are separate transactions; this one shares the suite's.
update private.audit_log set occurred_at = now() - interval '2 hours'
where action = 'circles.member_reattached' and metadata ->> 'to_user_id' = '30000000-0000-0000-0000-0000000000d4';
select pg_temp.act_as('30000000-0000-0000-0000-0000000000d5');
select public.reattach_member(pg_temp.c1(), '30000000-0000-0000-0000-0000000000d4');
select pg_temp.act_as_postgres();
select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000d3') i),
  array['30000000-0000-0000-0000-0000000000d3', '30000000-0000-0000-0000-0000000000d4',
        '30000000-0000-0000-0000-0000000000d5']::uuid[],
  'a membership moved twice links the whole chain to the identity it started on');
select pg_temp.act_as_service();
select public.verify_email_contact(pg_temp.hash_of('t-chain'));
select pg_temp.act_as_postgres();
select is(
  array[pg_temp.status_of('chain@example.com', '30000000-0000-0000-0000-0000000000d3'),
        pg_temp.status_of('chain@example.com', '30000000-0000-0000-0000-0000000000d5')],
  array['verified', 'verified'],
  'and verifying on the first identity reaches the copy two moves away');
select is(pg_temp.recipients('qqqqpk'),
  array[pg_temp.contact_of('chain@example.com', '30000000-0000-0000-0000-0000000000d5')],
  'so the moved place''s plan is deliverable');

-- ---------------------------------------------------------------------------
-- 4. What does not link two identities.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(i) from private.same_person_identities('30000000-0000-0000-0000-0000000000a1') i),
  array['30000000-0000-0000-0000-0000000000a1']::uuid[],
  'an identity with no recorded link is only itself');

-- One identity that took two places links each of them to it, and not to each other.
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata, occurred_at)
values
  ('30000000-0000-0000-0000-0000000000e3', 'circles.member_reattached', 'circle', pg_temp.c1(),
   jsonb_build_object('from_user_id', '30000000-0000-0000-0000-0000000000e1',
                      'to_user_id', '30000000-0000-0000-0000-0000000000e3', 'source', 'list'),
   now() - interval '3 hours'),
  ('30000000-0000-0000-0000-0000000000e3', 'circles.member_reattached', 'circle', pg_temp.c2(),
   jsonb_build_object('from_user_id', '30000000-0000-0000-0000-0000000000e2',
                      'to_user_id', '30000000-0000-0000-0000-0000000000e3', 'source', 'list'),
   now() - interval '2 hours');
select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000e1') i),
  array['30000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000e3']::uuid[],
  'a link is one hop in either direction');
select is(
  (select count(*)::integer from private.same_person_identities('30000000-0000-0000-0000-0000000000e1') i
   where i = '30000000-0000-0000-0000-0000000000e2'),
  0, 'and never the closure: two people who each lost a place to one taker are not one person');

-- One identity, one circle, two different memberships over time. A to B, B on
-- to D, then B takes C's place: A and C are not one person because B met both.
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata, occurred_at)
select null, 'circles.member_reattached', 'circle', pg_temp.c1(),
  jsonb_build_object('from_user_id', f, 'to_user_id', t, 'source', 'list'), now() - (h || ' hours')::interval
from (values
  ('30000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a2', 9),
  ('30000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a3', 8),
  ('30000000-0000-0000-0000-0000000000a4', '30000000-0000-0000-0000-0000000000a2', 7)
) v (f, t, h);
select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000a1') i),
  array['30000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a2',
        '30000000-0000-0000-0000-0000000000a3']::uuid[],
  'a membership''s chain runs through the identities it passed to, and stops there');
select is(
  (select count(*)::integer from private.same_person_identities('30000000-0000-0000-0000-0000000000a1') i
   where i = '30000000-0000-0000-0000-0000000000a4'),
  0, 'and not into the next place the same identity took in that circle');

-- The identity at the junction is directly linked to each neighbour (the
-- founder's rule: an identity linked by a recorded reattachment), so verifying
-- as it reaches all of them. What is not allowed is reaching *through* it.
select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000a2') i),
  array['30000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a2',
        '30000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-0000000000a4']::uuid[],
  'the identity both memberships passed through is linked to the people on both');

-- A membership that was passed on, and then the identity took another place:
-- the first place's chain does not continue into the other place's next move.
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata, occurred_at)
select null, 'circles.member_reattached', 'circle', pg_temp.c2(),
  jsonb_build_object('from_user_id', f, 'to_user_id', t, 'source', 'list'), now() - (h || ' hours')::interval
from (values
  ('30000000-0000-0000-0000-0000000000b4', '30000000-0000-0000-0000-0000000000b5', 9),
  ('30000000-0000-0000-0000-0000000000b6', '30000000-0000-0000-0000-0000000000b5', 8),
  ('30000000-0000-0000-0000-0000000000b5', '30000000-0000-0000-0000-0000000000b7', 7)
) v (f, t, h);
select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000b4') i),
  array['30000000-0000-0000-0000-0000000000b4', '30000000-0000-0000-0000-0000000000b5']::uuid[],
  'a place that was passed on is not carried over to the later place''s next move');
select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000b6') i),
  array['30000000-0000-0000-0000-0000000000b5', '30000000-0000-0000-0000-0000000000b6',
        '30000000-0000-0000-0000-0000000000b7']::uuid[],
  'while the later place''s own chain is whole');

-- A row for any other action links nothing.
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
values ('30000000-0000-0000-0000-0000000000f2', 'growth.account_claimed', 'account',
        '30000000-0000-0000-0000-0000000000f2',
        jsonb_build_object('from_user_id', '30000000-0000-0000-0000-0000000000f1',
                           'to_user_id', '30000000-0000-0000-0000-0000000000f2'));
select is(
  (select count(*)::integer from private.same_person_identities('30000000-0000-0000-0000-0000000000f2') i),
  1, 'a row for another action links nothing');

select is(
  has_function_privilege('authenticated', 'private.same_person_identities(uuid)', 'execute')
    or has_function_privilege('anon', 'private.same_person_identities(uuid)', 'execute'),
  false, 'no client can call the same-person query');

-- ---------------------------------------------------------------------------
-- 5. A claim carries verification across (guest to saved place).
-- ---------------------------------------------------------------------------

-- A verified contact travels verified.
select pg_temp.make_user('30000000-0000-0000-0000-0000000000a7', 'Claim guest one');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000a8', 'Claim saved one', true);
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000a7');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqph');
select pg_temp.act_as_service();
select public.request_email_updates((select id from public.plans where short_code = 'qqqqph'),
  '30000000-0000-0000-0000-0000000000a7', 'claim1@example.com', '2026-09-14', 'r-g1');
select public.issue_verification_token(
  pg_temp.contact_of('claim1@example.com', '30000000-0000-0000-0000-0000000000a7'),
  pg_temp.hash_of('t-g1'));
select public.verify_email_contact(pg_temp.hash_of('t-g1'));
select public.claim_identity('30000000-0000-0000-0000-0000000000a8',
  '30000000-0000-0000-0000-0000000000a7', 'after_answer');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('claim1@example.com', '30000000-0000-0000-0000-0000000000a8'),
  'verified', 'a claim carries a verified contact to the saved place, verified');
select is(pg_temp.status_of('claim1@example.com', '30000000-0000-0000-0000-0000000000a7'),
  null, 'and leaves nothing behind on the guest');
select is(pg_temp.recipients('qqqqph'),
  array[pg_temp.contact_of('claim1@example.com', '30000000-0000-0000-0000-0000000000a8')],
  'the saved place is deliverable for the plan');

-- A pending one travels pending, with its link, and the link still verifies it.
select pg_temp.make_user('30000000-0000-0000-0000-0000000000a9', 'Claim guest two');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000aa', 'Claim saved two', true);
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000a9');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqpj');
select pg_temp.act_as_service();
select public.request_email_updates((select id from public.plans where short_code = 'qqqqpj'),
  '30000000-0000-0000-0000-0000000000a9', 'claim2@example.com', '2026-09-14', 'r-g2');
select public.issue_verification_token(
  pg_temp.contact_of('claim2@example.com', '30000000-0000-0000-0000-0000000000a9'),
  pg_temp.hash_of('t-g2'));
select public.claim_identity('30000000-0000-0000-0000-0000000000aa',
  '30000000-0000-0000-0000-0000000000a9', 'after_answer');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('claim2@example.com', '30000000-0000-0000-0000-0000000000aa'),
  'pending', 'a pending contact travels pending');
select pg_temp.act_as_service();
select public.verify_email_contact(pg_temp.hash_of('t-g2'));
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('claim2@example.com', '30000000-0000-0000-0000-0000000000aa'),
  'verified', 'and the link it was sent verifies it');
select is(pg_temp.recipients('qqqqpj'),
  array[pg_temp.contact_of('claim2@example.com', '30000000-0000-0000-0000-0000000000aa')],
  'so the saved place is deliverable for that plan too');


-- A split, then a claim. The verification link stays on the guest the contact was
-- split from; the copy follows the membership to a new session and then to a
-- saved place, and only the recorded claim connects them.
select pg_temp.make_user('30000000-0000-0000-0000-0000000000c3', 'Split guest');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000c4', 'Split session');
select pg_temp.make_user('30000000-0000-0000-0000-0000000000c5', 'Split saved', true);
select pg_temp.join(pg_temp.c1(), '30000000-0000-0000-0000-0000000000c3');
select pg_temp.join(pg_temp.c2(), '30000000-0000-0000-0000-0000000000c3');
select pg_temp.plan_in(pg_temp.c1(), 'qqqqpn', 'ready');
select pg_temp.plan_in(pg_temp.c2(), 'qqqqpp');
select pg_temp.act_as_service();
select public.request_email_updates((select id from public.plans where short_code = 'qqqqpn'),
  '30000000-0000-0000-0000-0000000000c3', 'later@example.com', '2026-09-14', 'r-c3n');
select public.request_email_updates((select id from public.plans where short_code = 'qqqqpp'),
  '30000000-0000-0000-0000-0000000000c3', 'later@example.com', '2026-09-14', 'r-c3p');
select public.issue_verification_token(
  pg_temp.contact_of('later@example.com', '30000000-0000-0000-0000-0000000000c3'),
  pg_temp.hash_of('t-later'));
select pg_temp.act_as('30000000-0000-0000-0000-0000000000c4');
select public.reattach_member(pg_temp.c1(), '30000000-0000-0000-0000-0000000000c3');
select pg_temp.act_as_service();
select public.claim_identity('30000000-0000-0000-0000-0000000000c5',
  '30000000-0000-0000-0000-0000000000c4', 'reattached');
select pg_temp.act_as_postgres();
update private.audit_log set occurred_at = now() - interval '1 hour'
where action = 'circles.member_reattached' and metadata ->> 'to_user_id' = '30000000-0000-0000-0000-0000000000c4';

-- Locked in only now, so a letter is owed to whoever holds the place.
insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '30000000-0000-0000-0000-0000000000c5'::uuid from public.plans where short_code = 'qqqqpn';
insert into public.candidate_sets (
  plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select p.id, p.revision, p.input_version, p.scoring_version, 'seed', 10, 1, 1, 4
from public.plans p where p.short_code = 'qqqqpn';
insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select cset.id, false, 1, timestamptz '2099-09-18T08:30:00Z', timestamptz '2099-09-18T10:30:00Z',
  array['30000000-0000-0000-0000-0000000000c5'::uuid], 1, 0, 'best_attendance', 1
from public.candidate_sets cset join public.plans p on p.id = cset.plan_id
where p.short_code = 'qqqqpn';
select planning.transition_plan(
  (select id from public.plans where short_code = 'qqqqpn'), 'confirm',
  '30000000-0000-0000-0000-000000000001',
  jsonb_build_object('candidate_id', '2099-09-18T08:30:00+00:00'));

select is(
  (select array_agg(i order by i) from private.same_person_identities('30000000-0000-0000-0000-0000000000c3') i),
  array['30000000-0000-0000-0000-0000000000c3', '30000000-0000-0000-0000-0000000000c4',
        '30000000-0000-0000-0000-0000000000c5']::uuid[],
  'a claim is a recorded link, so the chain runs on from the session to the saved place');

select pg_temp.act_as_service();
select public.verify_email_contact(pg_temp.hash_of('t-later'));
select pg_temp.act_as_postgres();
select is(
  array[pg_temp.status_of('later@example.com', '30000000-0000-0000-0000-0000000000c3'),
        pg_temp.status_of('later@example.com', '30000000-0000-0000-0000-0000000000c5')],
  array['verified', 'verified'],
  'verifying on the guest reaches the copy that was reattached and then claimed');
select is(pg_temp.recipients('qqqqpn'),
  array[pg_temp.contact_of('later@example.com', '30000000-0000-0000-0000-0000000000c5')],
  'and the saved place is deliverable for the moved plan');
select is(
  (select array_agg(j.contact_id) from jobs.notification_jobs j
   where j.kind = 'locked_in' and j.plan_id = (select id from public.plans where short_code = 'qqqqpn')),
  array[pg_temp.contact_of('later@example.com', '30000000-0000-0000-0000-0000000000c5')],
  'and the "locked in" letter is addressed to the contact that holds that subscription, not the one the link named');

select * from finish();
rollback;
