-- SUS-114: the digest of an invite secret or a re-entry token is not a way in.
--
-- The database keeps only SHA-256 of both (ADR 0028, architecture §14), so that
-- a copy of `circle_invites` or `email_action_tokens` is not a set of working
-- links. That only holds if no client can *call* the functions that take a
-- digest. They are the service role's, and their Edge Functions pass the person
-- they verified.
--
--   * a client holding a stored digest is refused, by every client role;
--   * the old signatures are gone, not left beside the new ones;
--   * the per-caller limit from SUS-116 is charged to the person named, and a
--     different person's allowance is untouched;
--   * the owner's `live_invite` is the service role's too;
--   * one digest names at most one invite, across circles, live or revoked.

begin;
select plan(24);

create or replace function pg_temp.make_user(id uuid, name text, permanent boolean default true)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', now(), not permanent,
    jsonb_build_object('is_anonymous', not permanent),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid, anonymous boolean default false) returns void language plpgsql as $$
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

create or replace function pg_temp.act_as_nobody() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.fill(scope text, key text, size integer)
returns void language plpgsql as $$
declare
  was text := current_user;
begin
  perform set_config('role', 'postgres', true);
  perform public.take_rate_token(scope, extensions.digest(key, 'sha256'), size, interval '1 hour', size);
  perform set_config('role', was, true);
end;
$$;

-- Maya and Omar each own a circle. Gus and Hal are anonymous guests.
select pg_temp.make_user('48000000-0000-0000-0000-0000000000a1', 'Maya');
select pg_temp.make_user('48000000-0000-0000-0000-0000000000a2', 'Omar');
select pg_temp.make_user('48000000-0000-0000-0000-0000000000a3', 'Gus', false);
select pg_temp.make_user('48000000-0000-0000-0000-0000000000a4', 'Hal', false);

select pg_temp.act_as('48000000-0000-0000-0000-0000000000a1');
select public.create_circle('Digest Crew 480', 'sky', 'Australia/Melbourne', 'key-480-a', 'none',
  extensions.digest('sunday-secret', 'sha256'));
select pg_temp.act_as('48000000-0000-0000-0000-0000000000a2');
select public.create_circle('Look-alike', 'plum', 'Australia/Melbourne', 'key-480-b');

-- ---------------------------------------------------------------------------
-- Not callable by a client, whatever the digest
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('authenticated', 'public.redeem_invite(uuid, bytea, text)', 'execute')
  and not has_function_privilege('anon', 'public.redeem_invite(uuid, bytea, text)', 'execute')
  and has_function_privilege('service_role', 'public.redeem_invite(uuid, bytea, text)', 'execute'),
  'redeem_invite: the service role only'
);
select ok(
  not has_function_privilege('authenticated', 'public.reattach_with_token(uuid, bytea)', 'execute')
  and not has_function_privilege('anon', 'public.reattach_with_token(uuid, bytea)', 'execute')
  and has_function_privilege('service_role', 'public.reattach_with_token(uuid, bytea)', 'execute'),
  'the token form of reattach_member: the service role only'
);
select ok(
  has_function_privilege('authenticated', 'public.reattach_member(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reattach_member(uuid, uuid)', 'execute'),
  'and the Continue-as list form stays the signed-in caller''s'
);
select ok(
  not has_function_privilege('authenticated', 'private.reattach_member_core(uuid, uuid, uuid, bytea)', 'execute')
  and not has_function_privilege('service_role', 'private.reattach_member_core(uuid, uuid, uuid, bytea)', 'execute'),
  'the body they share is nobody''s to call'
);
select is(
  (to_regprocedure('public.redeem_invite(bytea, text)') is null)::text
  || (to_regprocedure('public.reattach_member(uuid, uuid, bytea)') is null)::text
  || (to_regprocedure('public.live_invite(uuid)') is null)::text,
  'truetruetrue',
  'the old signatures, which took only a digest and the caller''s session, are gone'
);

-- A copy of the table in hand: the stored digest, read as the postgres role, is
-- offered by a signed-in guest over RPC and is refused outright.
select pg_temp.act_as_postgres();
create temporary table stolen as
  select secret_hash as digest from public.circle_invites
  where circle_id = (select id from public.circles where name = 'Digest Crew 480') and revoked_at is null;
grant select on stolen to authenticated, anon, service_role;

select pg_temp.act_as('48000000-0000-0000-0000-0000000000a3', true);
select throws_ok(
  $$select public.redeem_invite('48000000-0000-0000-0000-0000000000a3', (select digest from stolen), 'Gus')$$,
  '42501', 'permission denied for function redeem_invite',
  'a stored invite digest does not join a signed-in guest to the circle'
);
select throws_ok(
  $$select public.reattach_with_token('48000000-0000-0000-0000-0000000000a3', (select digest from stolen))$$,
  '42501', 'permission denied for function reattach_with_token',
  'nor does a stored digest of any kind reattach one'
);
select throws_ok(
  $$select public.reattach_member(null, null, (select digest from stolen))$$,
  '42883', null,
  'and the list function takes no digest to be offered one'
);
select throws_ok(
  $$select * from public.live_invite((select id from public.circles where name = 'Digest Crew 480'))$$,
  '42883', null,
  'the owner''s digest is no longer returned to a client'
);
select pg_temp.act_as('48000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$select * from public.live_invite((select id from public.circles where name = 'Digest Crew 480'), '48000000-0000-0000-0000-0000000000a1')$$,
  '42501', 'permission denied for function live_invite',
  'not even to the owner, who does not need it'
);

-- ---------------------------------------------------------------------------
-- The service role's call: the verified person is named, and is who joins
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select lives_ok(
  $$select public.redeem_invite('48000000-0000-0000-0000-0000000000a3', (select digest from stolen), 'Gus')$$,
  'the Edge Function''s call, naming the person it verified, joins them'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.circle_members
   where circle_id = (select id from public.circles where name = 'Digest Crew 480')
     and user_id = '48000000-0000-0000-0000-0000000000a3' and status = 'active'),
  1,
  'and the membership lands on that person'
);
select pg_temp.act_as_service();
select throws_ok(
  $$select public.redeem_invite(null, (select digest from stolen), 'Nobody')$$,
  '42501', 'redeem_invite requires the person joining',
  'with nobody named it refuses, rather than reading a session it does not have'
);
select throws_ok(
  $$select public.reattach_with_token(null, extensions.digest('anything', 'sha256'))$$,
  '42501', 'reattach_with_token requires the person coming back',
  'the same for the emailed link'
);

-- ---------------------------------------------------------------------------
-- SUS-116's per-person limit is charged to the person named
-- ---------------------------------------------------------------------------
select pg_temp.fill('redeem_invite_sql', '48000000-0000-0000-0000-0000000000a4', 120);
select pg_temp.act_as_service();
select throws_ok(
  $$select public.redeem_invite('48000000-0000-0000-0000-0000000000a4', (select digest from stolen), 'Hal')$$,
  'P0003', 'too_many_requests',
  'a person who has used their hundred and twenty an hour is refused'
);
select lives_ok(
  $$select public.redeem_invite('48000000-0000-0000-0000-0000000000a3', (select digest from stolen), 'Gus')$$,
  'and somebody else''s allowance is untouched by it'
);

-- ---------------------------------------------------------------------------
-- live_invite: the owner it is told about, and only for the server
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(
  (select secret_hash from public.live_invite(
     (select id from public.circles where name = 'Digest Crew 480'),
     '48000000-0000-0000-0000-0000000000a1')),
  (select digest from stolen),
  'the server is told the owner''s live digest'
);
select throws_ok(
  $$select * from public.live_invite(
      (select id from public.circles where name = 'Digest Crew 480'),
      '48000000-0000-0000-0000-0000000000a2')$$,
  '42501', 'not_the_owner',
  'but not for somebody who owns another circle'
);
select throws_ok(
  $$select * from public.live_invite(
      (select id from public.circles where name = 'Digest Crew 480'), null)$$,
  '42501', 'live_invite requires the owner asking',
  'or for nobody'
);

-- ---------------------------------------------------------------------------
-- One digest names at most one invite, across circles, live or revoked
-- ---------------------------------------------------------------------------
select pg_temp.act_as('48000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$select public.issue_invite(
      (select id from public.circles where name = 'Look-alike'), (select digest from stolen))$$,
  '23505', null,
  'another circle''s owner cannot issue an invite with a digest the first circle holds'
);
select throws_ok(
  $$select public.create_circle('Another look-alike', 'sky', 'Australia/Melbourne', 'key-480-c', 'none',
      (select digest from stolen))$$,
  '23505', null,
  'nor create a circle with it'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.circle_invites
   where secret_hash = (select digest from stolen) and revoked_at is null
     and circle_id = (select id from public.circles where name = 'Digest Crew 480')),
  1,
  'and the first circle''s link is exactly as it was'
);

select pg_temp.act_as('48000000-0000-0000-0000-0000000000a1');
select public.issue_invite(
  (select id from public.circles where name = 'Digest Crew 480'), extensions.digest('second-secret', 'sha256'));
select pg_temp.act_as('48000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$select public.issue_invite(
      (select id from public.circles where name = 'Look-alike'), (select digest from stolen))$$,
  '23505', null,
  'a link the owner has since reset still cannot be claimed by a look-alike'
);
select lives_ok(
  $$select public.issue_invite(
      (select id from public.circles where name = 'Look-alike'), extensions.digest('its-own-secret', 'sha256'))$$,
  'while a digest nobody holds is accepted'
);

select * from finish();
rollback;
