-- SUS-164: the owner-only `delivery` signal.
--
-- `request_email_updates` answers `{sent}` and nothing else, so that nobody can
-- walk a list of addresses through a plan and learn which of their friends use
-- the product. The one person entitled to the truth is the address's own
-- confirmed owner (`email_confirmed_at` set, not anonymous, the same normalised
-- address), who has just proved it with a code: for them, and only them, the
-- answer also carries `delivery` (live, pending, suppressed). Everybody else
-- gets exactly the jsonb they got before, with no `delivery` key at all.

begin;
select plan(13);

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

-- Ben has a pending contact at Ada's address; Cleo's contact is verified
-- already; both of those leave Sam's address suppressed.
select public.request_email_updates(pg_temp.plan_id(),
  '00000000-0000-0000-0000-0000000009a2', 'ada@proof.test', '2026-10-06', 'r-ben-ada');

-- ---------------------------------------------------------------------------
-- Allow: the caller's own confirmed address
-- ---------------------------------------------------------------------------
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a1', 'ada@proof.test', '2026-10-06', 'r-ada'),
  '{"sent": false, "delivery": "live"}'::jsonb,
  'own and live: the owner is told the emails are on');
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a1', 'ada@proof.test', '2026-10-06', 'r-ada-again'),
  '{"sent": false, "delivery": "live"}'::jsonb,
  'and asking again, with the contact verified already, says the same');
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a6', 'sam@proof.test', '2026-10-06', 'r-sam'),
  '{"sent": false, "delivery": "suppressed"}'::jsonb,
  'own and suppressed: the owner is told nothing will be sent');

-- ---------------------------------------------------------------------------
-- Deny: everyone else gets the neutral answer, byte for byte
-- ---------------------------------------------------------------------------
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a3', 'ada@proof.test', '2026-10-06', 'r-cleo-ada'),
  '{"sent": true}'::jsonb,
  'somebody else''s address, which is live for its owner: the answer is the neutral one');
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a3', 'sam@proof.test', '2026-10-06', 'r-cleo-sam'),
  '{"sent": false}'::jsonb,
  'somebody else''s address, which is suppressed: the neutral answer, no mention of it');
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a1', 'other@proof.test', '2026-10-06', 'r-ada-other'),
  '{"sent": true}'::jsonb,
  'a confirmed member asking about an address that is not their own: neutral');
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a4', 'dev@proof.test', '2026-10-06', 'r-dev'),
  '{"sent": true}'::jsonb,
  'an address auth has not confirmed is not ownership: neutral');
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a5', 'gus@proof.test', '2026-10-06', 'r-gus'),
  '{"sent": true}'::jsonb,
  'an anonymous caller: neutral');
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a5', 'sam@proof.test', '2026-10-06', 'r-gus-sam'),
  '{"sent": false}'::jsonb,
  'an anonymous caller asking about a suppressed address: neutral');
select ok(
  not (public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a3', 'ada@proof.test', '2026-10-06', 'r-cleo-ada-2') ? 'delivery'),
  'no key called delivery exists in a non-owner''s answer');

-- Dev confirms the address afterwards: from then on it is theirs to be told.
select pg_temp.act_as_postgres();
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000009a4';
select pg_temp.act_as_service();
select is(
  public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a4', 'dev@proof.test', '2026-10-06', 'r-dev-2'),
  '{"sent": false, "delivery": "live"}'::jsonb,
  'once the address is confirmed the same request is answered as its owner');

-- Ben's own confirmed address.
select is(
  (public.request_email_updates(pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000009a2', 'ben@proof.test', '2026-10-06', 'r-ben') ->> 'delivery'),
  'live',
  'the owner''s own address is recognised by its normalised form');
select is(
  (select count(*)::integer from private.email_recipients_for(pg_temp.plan_id()) r
   where r.user_id = '00000000-0000-0000-0000-0000000009a6'),
  0,
  'and the suppressed owner is still not a recipient');

select * from finish();
rollback;
