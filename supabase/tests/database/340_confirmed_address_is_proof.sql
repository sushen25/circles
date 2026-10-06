-- SUS-162: a confirmed sign-in address is proof for the caller's own contact.
--
-- `request_email_updates` inserts the contact pending and queues a verification
-- link, unless the contact is already verified. For a caller whose own auth
-- address is confirmed (`email_confirmed_at` set) and is the address they ask
-- for, the contact is verified at once and nothing is sent (ADR 0027: a link and
-- a confirmed sign-in are two ways of obtaining the same proof). The rule stops
-- at the caller: another identity's contact at the same address is not promoted
-- (ADR 0050), a different address takes the link path, an anonymous caller is
-- unchanged, and a suppressed address still says nothing and sends nothing.

begin;
select plan(20);

create or replace function pg_temp.make_user(
  id uuid, name text, addr text, confirmed boolean, anonymous boolean default false
) returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    addr, case when confirmed then now() end, anonymous,
    jsonb_build_object('is_anonymous', anonymous),
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

create or replace function pg_temp.contact_of(addr text, who uuid) returns uuid
language sql security definer as $$
  select c.id from private.email_contacts c where c.email_normalized = addr and c.user_id = who
$$;
create or replace function pg_temp.status_of(addr text, who uuid) returns text
language sql security definer as $$
  select c.status from private.email_contacts c
  where c.email_normalized = addr and c.user_id = who
$$;
create or replace function pg_temp.verify_jobs(who uuid) returns integer
language sql security definer as $$
  select count(*)::integer from jobs.notification_jobs j
  join private.email_contacts c on c.id = j.contact_id
  where j.kind = 'verify_email' and c.user_id = who
$$;

-- Maya owns the circle. Ada, Ben and Cleo hold confirmed addresses; Dev has an
-- address nobody has confirmed; Gus is an anonymous guest; Sam's address was
-- suppressed after a bounce.
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a0', 'Maya', 'maya@proof.test', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a1', 'Ada', 'ada@proof.test', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a2', 'Ben', 'ben@proof.test', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a3', 'Cleo', 'cleo@proof.test', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a4', 'Dev', 'dev@proof.test', false);
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a5', 'Gus', null, false, true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a6', 'Sam', 'sam@proof.test', true);

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a0');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-proof');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-proof';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select t.circle_id, u.id, u.name
from t, (values
  ('00000000-0000-0000-0000-0000000009a1'::uuid, 'Ada'),
  ('00000000-0000-0000-0000-0000000009a2'::uuid, 'Ben'),
  ('00000000-0000-0000-0000-0000000009a3'::uuid, 'Cleo'),
  ('00000000-0000-0000-0000-0000000009a4'::uuid, 'Dev'),
  ('00000000-0000-0000-0000-0000000009a5'::uuid, 'Gus'),
  ('00000000-0000-0000-0000-0000000009a6'::uuid, 'Sam')) as u(id, name);

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000009a0',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pcnfab'
from t;
create temporary table tp as select id as plan_id from public.plans where short_code = 'pcnfab';
grant select on tp to anon, authenticated, service_role;
create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select plan_id from tp $$;

insert into private.email_suppressions (email_hash, reason)
values (extensions.digest('sam@proof.test', 'sha256'), 'bounced');

select pg_temp.act_as_service();

-- Ben typed Ada's address first, and never opened the letter: pending.
select public.request_email_updates(pg_temp.plan_id(),
  '00000000-0000-0000-0000-0000000009a2', 'ada@proof.test', '2026-10-06', 'r-ben-ada');

-- ---------------------------------------------------------------------------
-- Allow: the caller's own confirmed address
-- ---------------------------------------------------------------------------
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000009a1', 'ada@proof.test', '2026-10-06', 'r-ada') ->> 'sent'),
  'false',
  'a signed-in caller asking for their own confirmed address is sent no link'
);

select pg_temp.act_as_postgres();
select is(pg_temp.status_of('ada@proof.test', '00000000-0000-0000-0000-0000000009a1'), 'verified',
  'their contact for it is verified, by the confirmed sign-in rather than a link');
select is(pg_temp.verify_jobs('00000000-0000-0000-0000-0000000009a1'), 0,
  'and no verification email was queued');
select is(
  (select s.status || ' ' || s.consent_text_version from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id
   where c.user_id = '00000000-0000-0000-0000-0000000009a1' and s.plan_id = pg_temp.plan_id()),
  'active 2026-10-06',
  'and the subscription is live at once, under the version shown');
select ok(
  exists (select 1 from private.email_contacts c
    where c.user_id = '00000000-0000-0000-0000-0000000009a1' and c.verified_at is not null
      and c.email_normalized = 'ada@proof.test'),
  'the contact records when it was verified');

select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000009a3', 'cleo@proof.test', '2026-10-06', 'r-cleo') ->> 'sent'),
  'false',
  'another member with a confirmed address gets the same: verified, no link');

-- ---------------------------------------------------------------------------
-- Deny: it stops at the caller
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('ada@proof.test', '00000000-0000-0000-0000-0000000009a2'), 'pending',
  'another identity''s pending contact at that address is not promoted (ADR 0050)');

select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000009a1', 'other@proof.test', '2026-10-06', 'r-ada-other') ->> 'sent'),
  'true',
  'a different address from the confirmed one takes the link path');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('other@proof.test', '00000000-0000-0000-0000-0000000009a1'), 'pending',
  'and stays pending until the link is followed');
select is(pg_temp.verify_jobs('00000000-0000-0000-0000-0000000009a1'), 1,
  'with its verification email queued');

select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000009a4', 'dev@proof.test', '2026-10-06', 'r-dev') ->> 'sent'),
  'true',
  'an address auth has not confirmed is not proof: the link path');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('dev@proof.test', '00000000-0000-0000-0000-0000000009a4'), 'pending',
  'and the contact is pending');

select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000009a5', 'gus@proof.test', '2026-10-06', 'r-gus') ->> 'sent'),
  'true',
  'an anonymous caller is unchanged: a link is sent');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('gus@proof.test', '00000000-0000-0000-0000-0000000009a5'), 'pending',
  'and nothing is verified');

-- ---------------------------------------------------------------------------
-- Deny: a suppressed address is still silence
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000009a6', 'sam@proof.test', '2026-10-06', 'r-sam') ->> 'sent'),
  'false',
  'a suppressed address sends nothing, even to the person whose confirmed address it is');
select pg_temp.act_as_postgres();
select is(pg_temp.status_of('sam@proof.test', '00000000-0000-0000-0000-0000000009a6'), 'suppressed',
  'the contact stays suppressed, not promoted by the confirmed sign-in');
select is(
  (select count(*)::integer from private.email_recipients_for(pg_temp.plan_id()) r
   where r.user_id = '00000000-0000-0000-0000-0000000009a6'),
  0,
  'and nothing would be delivered to it');
select is(
  (select count(*)::integer from private.email_recipients_for(pg_temp.plan_id()) r
   where r.user_id = '00000000-0000-0000-0000-0000000009a1'),
  1,
  'while the verified one is a recipient straight away');

-- ---------------------------------------------------------------------------
-- A plan already locked in: the subscription owes the current state, once
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'ready', '00000000-0000-0000-0000-0000000009a0',
  'Decided', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pcnfac'
from t;
insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '00000000-0000-0000-0000-0000000009a1'::uuid from public.plans where short_code = 'pcnfac';
insert into public.candidate_sets (
  plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select p.id, p.revision, p.input_version, p.scoring_version, 'seed', 10, 1, 1, 4
from public.plans p where p.short_code = 'pcnfac';
insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select cset.id, false, 1, timestamptz '2099-09-18T08:30:00Z', timestamptz '2099-09-18T10:30:00Z',
  array['00000000-0000-0000-0000-0000000009a1'::uuid], 1, 0, 'best_attendance', 1
from public.candidate_sets cset join public.plans p on p.id = cset.plan_id
where p.short_code = 'pcnfac';
select planning.transition_plan(
  (select id from public.plans where short_code = 'pcnfac'), 'confirm',
  '00000000-0000-0000-0000-0000000009a0',
  jsonb_build_object('candidate_id', '2099-09-18T08:30:00+00:00'));

select pg_temp.act_as_service();
select public.request_email_updates((select id from public.plans where short_code = 'pcnfac'),
  '00000000-0000-0000-0000-0000000009a1', 'ada@proof.test', '2026-10-06', 'r-ada-late');
select public.request_email_updates((select id from public.plans where short_code = 'pcnfac'),
  '00000000-0000-0000-0000-0000000009a1', 'ada@proof.test', '2026-10-06', 'r-ada-late-2');
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.notification_jobs j
   where j.kind = 'locked_in'
     and j.plan_id = (select id from public.plans where short_code = 'pcnfac')
     and j.contact_id = pg_temp.contact_of('ada@proof.test', '00000000-0000-0000-0000-0000000009a1')),
  1,
  'subscribing with a confirmed address after the time was decided queues the current "locked in" letter, once');
select is(
  (select count(*)::integer from jobs.notification_jobs j
   where j.kind = 'verify_email'
     and j.plan_id = (select id from public.plans where short_code = 'pcnfac')),
  0,
  'and still sends no verification email');

select * from finish();
rollback;
