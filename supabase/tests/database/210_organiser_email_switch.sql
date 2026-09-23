-- "Emails about plans you organise" (SUS-83, ADR 00XX).
--
-- The switch is a column on the person's own profile. What it stops is the
-- domain's rule, proved in `organiser-email.test.ts`; what is proved here is
-- the storage and the two places the dispatcher reads it — that only its owner
-- can move it, and that the dispatcher sees it both when it writes a job and
-- when the job is due.
--
-- Maya organises and has confirmed her address by signing in. Tom is in the
-- circle with an account of his own. Nobody else is involved.

begin;
select plan(16);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', now(), false,
    jsonb_build_object('is_anonymous', false),
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

create or replace function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
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

create or replace function pg_temp.muted(who uuid) returns boolean
language sql security definer as $$
  select p.muted_organiser_email from public.profiles p where p.user_id = who
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000021a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000021a2', 'Tom');

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

select col_not_null('public', 'profiles', 'muted_organiser_email', 'the switch is never unknown');
select col_default_is(
  'public', 'profiles', 'muted_organiser_email', 'false',
  'and is on until somebody turns it off: organiser email is what review C6 promises'
);
select is(pg_temp.muted('00000000-0000-0000-0000-0000000021a1'), false, 'a new profile has it on');

-- ---------------------------------------------------------------------------
-- Only its owner moves it
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000021a1');
select lives_ok(
  $$update public.profiles set muted_organiser_email = true
    where user_id = '00000000-0000-0000-0000-0000000021a1'$$,
  'an organiser may turn their own organiser email off'
);
select pg_temp.act_as_postgres();
select is(pg_temp.muted('00000000-0000-0000-0000-0000000021a1'), true, 'and it is off');

select pg_temp.act_as('00000000-0000-0000-0000-0000000021a2');
update public.profiles set muted_organiser_email = false
where user_id = '00000000-0000-0000-0000-0000000021a1';
select pg_temp.act_as_postgres();
select is(
  pg_temp.muted('00000000-0000-0000-0000-0000000021a1'), true,
  'somebody else cannot turn it back on for her: the row is not theirs'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000021a2');
update public.profiles set muted_organiser_email = true
where user_id = '00000000-0000-0000-0000-0000000021a1';
select pg_temp.act_as_postgres();
select is(
  pg_temp.muted('00000000-0000-0000-0000-0000000021a2'), false,
  'nor does trying to change hers change their own'
);

select pg_temp.act_as_anon();
select throws_ok(
  $$update public.profiles set muted_organiser_email = true
    where user_id = '00000000-0000-0000-0000-0000000021a2'$$,
  '42501', null,
  'anon cannot touch it at all'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000021a1');
select throws_ok(
  $$update public.profiles set is_permanent = true
    where user_id = '00000000-0000-0000-0000-0000000021a1'$$,
  '42501', null,
  'the grant is for this column, not for the profile: is_permanent is still nobody''s to set'
);

-- ---------------------------------------------------------------------------
-- The dispatcher sees it when it writes a job
-- ---------------------------------------------------------------------------

select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-sus83');
select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id from public.circles where creation_key = 'key-sus83';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000021a2', 'Tom' from t;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000021a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'sus8zz'
from t;

create or replace function pg_temp.the_plan() returns uuid
language sql security definer as $$ select id from public.plans where short_code = 'sus8zz' $$;

create or replace function pg_temp.member_flag(who uuid) returns boolean
language sql security definer as $$
  select (m ->> 'muted_organiser_email')::boolean
  from jsonb_array_elements(public.dispatch_context(pg_temp.the_plan()) -> 'members') m
  where m ->> 'user_id' = who::text
$$;

select pg_temp.act_as_service();
select is(
  pg_temp.member_flag('00000000-0000-0000-0000-0000000021a1'), true,
  'dispatch_context carries the organiser''s switch on her member row'
);
select is(
  pg_temp.member_flag('00000000-0000-0000-0000-0000000021a2'), false,
  'and everybody else''s, which is on'
);

-- ---------------------------------------------------------------------------
-- And again when the job is due
-- ---------------------------------------------------------------------------

-- Written before she turned it off, as a did-it-happen letter is: at
-- confirmation, for the next morning.
select pg_temp.act_as_service();
select isnt(
  public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000021a1'), null,
  'the switch does not take her contact away (ADR 0027): the address stays reachable'
);
select is(
  public.dispatch_enqueue(jsonb_build_array(
    jsonb_build_object('channel', 'email', 'kind', 'did_it_happen',
      'contact_id', public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000021a1'),
      'plan_id', pg_temp.the_plan(), 'plan_revision', 1,
      'scheduled_for', now() - interval '1 minute', 'idempotency_key',
      encode(extensions.digest('sus83-did-it-happen', 'sha256'), 'hex')))),
  1,
  'a did-it-happen letter is queued for her'
);

create or replace function pg_temp.due_flag() returns boolean
language sql as $$
  select (j ->> 'organiser_email_muted')::boolean
  from jsonb_array_elements(public.dispatch_claim_due(200)) j
  where j ->> 'plan_id' = pg_temp.the_plan()::text
$$;

select is(pg_temp.due_flag(), true, 'dispatch_claim_due says her switch is off, now');

select pg_temp.act_as_postgres();
update public.profiles set muted_organiser_email = false
where user_id = '00000000-0000-0000-0000-0000000021a1';
select pg_temp.act_as_service();
select is(
  pg_temp.due_flag(), false,
  'and read at the moment of sending, so turning it back on lets the queued letter go'
);

select pg_temp.act_as_postgres();
select is(
  (select c.status from private.email_contacts c
   where c.user_id = '00000000-0000-0000-0000-0000000021a1'),
  'verified',
  'turning it off and on again never suppressed her address: that is permanent, and this is not'
);

select * from finish();
rollback;
