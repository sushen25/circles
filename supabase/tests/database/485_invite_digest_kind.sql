-- SUS-214, ADR 0081: an invite secret and a re-entry token are stored under an
-- HMAC that a copy of the database cannot reproduce, and a link made before
-- that still opens its circle for as long as ADR 0081 says.
--
-- The database cannot tell an HMAC from any other 32 bytes: the Edge Function
-- makes it under `INVITE_DIGEST_KEY`, which no table, function or setting here
-- holds. What the database does hold is which kind each stored digest is
-- (`digest_kind`), and that is what these prove:
--
--   * a new invite and a new re-entry token are `hmac`; older rows are `sha256`;
--   * an `hmac` row is found only by the current digest and a `sha256` row only
--     by the legacy one, so neither slot can stand in for the other, and the
--     plain SHA-256 of a new link's secret opens nothing;
--   * the same for the Join page's preview and for the emailed re-entry link;
--   * `live_invite` says which kind it is, so `get-invite-link` can compare.
--
-- `pg_temp.mac` stands in for the Edge Function's HMAC with a test key.

begin;
select plan(30);

create or replace function pg_temp.mac(t text) returns bytea language sql as $$
  select extensions.hmac(t, 'a-test-key-the-database-never-holds', 'sha256');
$$;
create or replace function pg_temp.sha(t text) returns bytea language sql as $$
  select extensions.digest(t, 'sha256');
$$;

-- The service role's call, made for whoever the test is acting as (SUS-114).
create or replace function pg_temp.redeem(cur bytea, legacy bytea, n text) returns public.circles
language plpgsql as $$
declare
  me uuid := auth.uid();
  prev text := current_setting('role');
  claims text := current_setting('request.jwt.claims', true);
  r public.circles;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.redeem_invite(me, cur, n, legacy);
  perform set_config('role', prev, true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return r;
end;
$$;

create or replace function pg_temp.reattach(cur bytea, legacy bytea) returns public.circles
language plpgsql as $$
declare
  me uuid := auth.uid();
  prev text := current_setting('role');
  claims text := current_setting('request.jwt.claims', true);
  r public.circles;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.reattach_with_token(me, cur, legacy);
  perform set_config('role', prev, true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return r;
end;
$$;

create or replace function pg_temp.preview(cur bytea, legacy bytea) returns integer
language plpgsql as $$
declare
  prev text := current_setting('role');
  claims text := current_setting('request.jwt.claims', true);
  n integer;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
  select count(*)::integer into n from public.invite_preview(cur, legacy);
  perform set_config('role', prev, true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return n;
end;
$$;

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous,
    jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select pg_temp.make_user('48500000-0000-0000-0000-0000000000a1', 'Maya');
select pg_temp.make_user('48500000-0000-0000-0000-0000000000a2', 'Omar');
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b1', 'Gus', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b2', 'Hal', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b3', 'Ivy', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b4', 'Jo', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b5', 'Kit', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b6', 'Lee', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b7', 'Mia', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b8', 'Ned', true);
select pg_temp.make_user('48500000-0000-0000-0000-0000000000b9', 'Ona', true);

-- Maya's circle is new, so its link is an HMAC. Omar's is an older one: the row
-- is made as the plain SHA-256 it would have been, and marked so.
select pg_temp.act_as('48500000-0000-0000-0000-0000000000a1');
select public.create_circle('Hmac Crew 485', 'sky', 'Australia/Melbourne', 'key-485-a', 'none',
  pg_temp.mac('new-secret'), digest_kind => 'hmac');
select pg_temp.act_as('48500000-0000-0000-0000-0000000000a2');
select public.create_circle('Legacy Crew 485', 'plum', 'Australia/Melbourne', 'key-485-b');
select pg_temp.act_as_postgres();
insert into public.circle_invites (circle_id, secret_hash, digest_kind, created_by)
select id, pg_temp.sha('old-secret'), 'sha256', '48500000-0000-0000-0000-0000000000a2'
from public.circles where name = 'Legacy Crew 485';

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
select is(
  (select digest_kind from public.circle_invites
   where circle_id = (select id from public.circles where name = 'Hmac Crew 485')),
  'hmac',
  'an invite the new function stores as an hmac says so'
);
select throws_ok(
  $$insert into public.circle_invites (circle_id, secret_hash, digest_kind, created_by)
    select id, pg_temp.sha('x'), 'md5', '48500000-0000-0000-0000-0000000000a1'
    from public.circles where name = 'Hmac Crew 485'$$,
  '23514', null,
  'and the kind is one of two'
);

-- ---------------------------------------------------------------------------
-- redeem_invite
-- ---------------------------------------------------------------------------
select pg_temp.act_as('48500000-0000-0000-0000-0000000000b1', true);
select lives_ok(
  $$select pg_temp.redeem(pg_temp.mac('new-secret'), pg_temp.sha('new-secret'), 'Gus')$$,
  'a new link opens with the HMAC (the legacy digest beside it is not what finds it)'
);
select pg_temp.act_as('48500000-0000-0000-0000-0000000000b2', true);
select throws_ok(
  $$select pg_temp.redeem(pg_temp.mac('nothing'), pg_temp.sha('new-secret'), 'Hal')$$,
  'P0002', 'invite_inactive',
  'the plain SHA-256 of a new link''s secret does not open it'
);
select pg_temp.act_as_postgres();
create temporary table stolen as
  select secret_hash as new_digest,
         (select secret_hash from public.circle_invites
          where circle_id = (select id from public.circles where name = 'Legacy Crew 485')) as old_digest
  from public.circle_invites
  where circle_id = (select id from public.circles where name = 'Hmac Crew 485');
grant select on stolen to authenticated, service_role;
select pg_temp.act_as('48500000-0000-0000-0000-0000000000b2', true);
select throws_ok(
  $$select pg_temp.redeem(pg_temp.mac('nothing'), (select new_digest from stolen), 'Hal')$$,
  'P0002', 'invite_inactive',
  'a stored HMAC offered in the legacy slot opens nothing'
);
select throws_ok(
  $$select pg_temp.redeem((select old_digest from stolen), null, 'Hal')$$,
  'P0002', 'invite_inactive',
  'and a stored SHA-256 offered as the current digest opens nothing'
);
select lives_ok(
  $$select pg_temp.redeem(pg_temp.mac('old-secret'), pg_temp.sha('old-secret'), 'Hal')$$,
  'an older link still opens, through the legacy digest'
);
select pg_temp.act_as_postgres();
select is(
  (select use_count from public.circle_invites
   where circle_id = (select id from public.circles where name = 'Legacy Crew 485')),
  1,
  'and is counted as used'
);
update public.circle_invites set revoked_at = now()
where circle_id = (select id from public.circles where name = 'Legacy Crew 485');
select pg_temp.act_as('48500000-0000-0000-0000-0000000000b3', true);
select throws_ok(
  $$select pg_temp.redeem(pg_temp.mac('old-secret'), pg_temp.sha('old-secret'), 'Ivy')$$,
  'P0002', 'invite_inactive',
  'a reset older link is dead through the legacy path too'
);

-- ---------------------------------------------------------------------------
-- invite_preview
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(pg_temp.preview(pg_temp.mac('new-secret'), pg_temp.sha('new-secret')), 1,
  'the Join page previews a new link by its HMAC');
select is(pg_temp.preview(pg_temp.mac('nothing'), pg_temp.sha('new-secret')), 0,
  'and not by the plain SHA-256 of its secret');
select pg_temp.act_as_postgres();
insert into public.circle_invites (circle_id, secret_hash, digest_kind, created_by)
select id, pg_temp.sha('old-secret-2'), 'sha256', '48500000-0000-0000-0000-0000000000a2'
from public.circles where name = 'Legacy Crew 485';
select pg_temp.act_as_service();
select is(pg_temp.preview(pg_temp.mac('old-secret-2'), pg_temp.sha('old-secret-2')), 1,
  'an older link previews through the legacy digest');
select is(pg_temp.preview(pg_temp.sha('old-secret-2'), null), 0,
  'but its stored SHA-256 offered as the current digest previews nothing');

-- ---------------------------------------------------------------------------
-- live_invite
-- ---------------------------------------------------------------------------
select is(
  (select digest_kind from public.live_invite(
     (select id from public.circles where name = 'Hmac Crew 485'),
     '48500000-0000-0000-0000-0000000000a1')),
  'hmac',
  'the server is told a new link''s digest is an hmac'
);
select is(
  (select digest_kind from public.live_invite(
     (select id from public.circles where name = 'Legacy Crew 485'),
     '48500000-0000-0000-0000-0000000000a2')),
  'sha256',
  'and an older link''s is a sha256'
);

-- ---------------------------------------------------------------------------
-- The emailed re-entry link
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select id, u, n from public.circles c,
  (values ('48500000-0000-0000-0000-0000000000b4'::uuid, 'Jo'),
          ('48500000-0000-0000-0000-0000000000b5'::uuid, 'Kit')) v(u, n)
where c.name = 'Hmac Crew 485';
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('48500000-0000-0000-0000-0000000000b4', 'jo485@example.com', 'verified', now()),
       ('48500000-0000-0000-0000-0000000000b5', 'kit485@example.com', 'verified', now());

select pg_temp.act_as_service();
select public.issue_reentry_token(
  (select id from public.circles where name = 'Hmac Crew 485'),
  (select id from private.email_contacts where email_normalized = 'jo485@example.com'),
  pg_temp.mac('jo-link'), 'hmac');
select pg_temp.act_as_postgres();
select is(
  (select digest_kind from private.email_action_tokens where token_hash = pg_temp.mac('jo-link')),
  'hmac',
  'a re-entry token issued now is stored as an hmac'
);
-- Kit's was emailed before the change: a plain SHA-256, as the column default says.
insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at,
                                          membership_circle_id, membership_user_id)
select ec.id, 'reentry', pg_temp.sha('kit-link'), now() + interval '7 days',
       (select id from public.circles where name = 'Hmac Crew 485'),
       '48500000-0000-0000-0000-0000000000b5'
from private.email_contacts ec where ec.email_normalized = 'kit485@example.com';
select is(
  (select digest_kind from private.email_action_tokens where token_hash = pg_temp.sha('kit-link')),
  'sha256',
  'one emailed before the change is a sha256'
);

select pg_temp.act_as('48500000-0000-0000-0000-0000000000b6', true);
select throws_ok(
  $$select pg_temp.reattach(pg_temp.mac('nothing'), pg_temp.sha('jo-link'))$$,
  'P0002', 'token_invalid',
  'the plain SHA-256 of a new token''s secret does not move a membership'
);
select throws_ok(
  $$select pg_temp.reattach(pg_temp.sha('kit-link'), null)$$,
  'P0002', 'token_invalid',
  'nor does an older token''s stored digest offered as the current one'
);
select throws_ok(
  $$select pg_temp.reattach(pg_temp.mac('nothing'), pg_temp.mac('jo-link'))$$,
  'P0002', 'token_invalid',
  'a stored HMAC offered in the legacy slot moves nothing'
);
select lives_ok(
  $$select pg_temp.reattach(pg_temp.mac('kit-link'), pg_temp.sha('kit-link'))$$,
  'an older token still works through the legacy digest'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.circle_members
   where user_id = '48500000-0000-0000-0000-0000000000b6' and status = 'active'),
  1,
  'and the membership lands on the caller'
);
select pg_temp.act_as('48500000-0000-0000-0000-0000000000b7', true);
select lives_ok(
  $$select pg_temp.reattach(pg_temp.mac('jo-link'), pg_temp.sha('jo-link'))$$,
  'a new token works with its HMAC'
);
select pg_temp.act_as_postgres();
select is(
  (select used_at is not null from private.email_action_tokens where token_hash = pg_temp.mac('jo-link')),
  true,
  'and is spent'
);
select pg_temp.act_as('48500000-0000-0000-0000-0000000000b3', true);
select throws_ok(
  $$select pg_temp.reattach(pg_temp.mac('jo-link'), pg_temp.sha('jo-link'))$$,
  'P0002', 'token_invalid',
  'once: a second use is refused whichever digest is offered'
);

-- ---------------------------------------------------------------------------
-- The saved-account branch reads the same two slots
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select id, '48500000-0000-0000-0000-0000000000b8', 'Ned' from public.circles where name = 'Hmac Crew 485';
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('48500000-0000-0000-0000-0000000000b8', 'ned485@example.com', 'verified', now());
insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at,
                                          membership_circle_id, membership_user_id)
select ec.id, 'reentry', pg_temp.sha('ned-link'), now() + interval '7 days',
       (select id from public.circles where name = 'Hmac Crew 485'),
       '48500000-0000-0000-0000-0000000000b8'
from private.email_contacts ec where ec.email_normalized = 'ned485@example.com';
-- Ned saves his place, in place: same id, now permanent.
update auth.users set is_anonymous = false, raw_app_meta_data = '{"is_anonymous": false}'
where id = '48500000-0000-0000-0000-0000000000b8';
update public.profiles set is_permanent = true where user_id = '48500000-0000-0000-0000-0000000000b8';

select pg_temp.act_as('48500000-0000-0000-0000-0000000000b8');
select lives_ok(
  $$select pg_temp.reattach(pg_temp.mac('nothing'), pg_temp.sha('ned-link'))$$,
  'the account a legacy link was for gets its circle back through the legacy digest'
);
select throws_ok(
  $$select pg_temp.reattach(pg_temp.sha('ned-link'), null)$$,
  '42501', 'caller_is_permanent',
  'but not with that stored SHA-256 offered as the current digest'
);
select pg_temp.act_as('48500000-0000-0000-0000-0000000000b9', true);
select throws_ok(
  $$select pg_temp.reattach(pg_temp.sha('ned-link'), null)$$,
  'P0002', 'token_invalid',
  'and a guest cannot use it that way either'
);

-- ---------------------------------------------------------------------------
-- An older function, which sends no kind, tells the truth about what it stores
-- ---------------------------------------------------------------------------
select pg_temp.act_as('48500000-0000-0000-0000-0000000000a2');
select public.issue_invite(
  (select id from public.circles where name = 'Legacy Crew 485'), pg_temp.sha('older-function'));
select pg_temp.act_as_postgres();
select is(
  (select digest_kind from public.circle_invites
   where secret_hash = pg_temp.sha('older-function')),
  'sha256',
  'an invite stored without a kind is labelled sha256, so the deploy window mislabels nothing'
);
select public.issue_reentry_token(
  (select id from public.circles where name = 'Hmac Crew 485'),
  (select id from private.email_contacts where email_normalized = 'jo485@example.com'),
  pg_temp.sha('older-token'));
select is(
  (select digest_kind from private.email_action_tokens where token_hash = pg_temp.sha('older-token')),
  'sha256',
  'and so is a re-entry token stored without one'
);

select * from finish();
rollback;
