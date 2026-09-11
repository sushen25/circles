-- Joining by link, and the list a guest is offered when they come back.
--
-- Everything here is asserted as a *client role* with a JWT, because the
-- functions under test read `auth.uid()` and the organiser gate reads the
-- `is_anonymous` claim: run as postgres they would all say yes.
--
-- The scenario is AGENTS.md's — Sunday Crew, Maya owning it, Priya and Tom
-- joining as guests — so that nothing here invents a second cast.

begin;
select plan(56);

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

create or replace function pg_temp.act_as_nobody()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
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

-- The digest the Edge Function sends. The secret itself never reaches the
-- database, which is the thing `redeem_invite`'s signature is for.
create or replace function pg_temp.digest_of(secret text)
returns bytea
language sql
as $$ select extensions.digest(secret, 'sha256') $$;

select pg_temp.make_user('90000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('90000000-0000-0000-0000-000000000002', 'Priya', true);
select pg_temp.make_user('90000000-0000-0000-0000-000000000003', 'Tom', true);
select pg_temp.make_user('90000000-0000-0000-0000-000000000004', 'Jess', true);
select pg_temp.make_user('90000000-0000-0000-0000-000000000005', 'Sam');

select pg_temp.act_as('90000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id, short_code
from public.create_circle('Sunday Crew', '#336699', 'Australia/Melbourne', 'sus29-join');
grant select on fixture to authenticated, anon;

select pg_temp.act_as_postgres();

-- Reading, as the test rather than as the actor. `circle_invites` is not
-- readable by a member — the secret digest lives there — and an assertion about
-- the use count should not have to stop being Priya to make it.
create or replace function pg_temp.invite_uses(p_circle uuid)
returns integer
language sql
security definer
as $$
  select i.use_count from public.circle_invites i
  where i.circle_id = p_circle and i.revoked_at is null;
$$;

create or replace function pg_temp.membership(p_circle uuid, p_user uuid)
returns public.circle_members
language sql
security definer
as $$
  select * from public.circle_members m where m.circle_id = p_circle and m.user_id = p_user;
$$;

create or replace function pg_temp.active_members(p_circle uuid)
returns integer
language sql
security definer
as $$
  select count(*)::integer from public.circle_members m
  where m.circle_id = p_circle and m.status = 'active';
$$;

create or replace function pg_temp.joined_events(p_user uuid)
returns integer
language sql
security definer
as $$
  select count(*)::integer from jobs.outbox o
  where o.event_name = 'circles.member_joined' and o.payload ->> 'user_id' = p_user::text;
$$;

create or replace function pg_temp.circle_id()
returns uuid
language sql
security definer
as $$ select circle_id from fixture $$;

insert into public.circle_invites (circle_id, secret_hash, created_by)
select circle_id, pg_temp.digest_of('live-secret'), '90000000-0000-0000-0000-000000000001'
from fixture;
insert into public.circle_invites (circle_id, secret_hash, created_by, revoked_at)
select circle_id, pg_temp.digest_of('rotated-secret'), '90000000-0000-0000-0000-000000000001',
       now() - interval '1 hour'
from fixture;

-- ---------------------------------------------------------------------------
-- redeem_invite
-- ---------------------------------------------------------------------------
select pg_temp.act_as('90000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('no-such-secret'), 'Priya') $$,
  'invite_inactive',
  'a secret nobody issued is an inactive invite'
);

select throws_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('rotated-secret'), 'Priya') $$,
  'invite_inactive',
  'a rotated link is an inactive invite, not a different error'
);

select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), 'Priya') $$,
  'a guest redeems a live link'
);

select is(
  (pg_temp.membership(pg_temp.circle_id(), '90000000-0000-0000-0000-000000000002')).status,
  'active',
  'and is an active member of the circle'
);

select is(
  (pg_temp.membership(pg_temp.circle_id(), '90000000-0000-0000-0000-000000000002')).display_name_snapshot,
  'Priya',
  'under the name they gave'
);

select is(
  (pg_temp.membership(pg_temp.circle_id(), '90000000-0000-0000-0000-000000000002')).role,
  'member',
  'as a member, never an owner'
);

select is(pg_temp.invite_uses(pg_temp.circle_id()), 1, 'one redemption, one use counted');

-- Idempotence by state: the same caller, the same link, again.
select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), 'Priya') $$,
  'redeeming twice is not an error'
);

select is(pg_temp.invite_uses(pg_temp.circle_id()), 1, 'and does not count a second use');

select is(
  (select count(*)::integer from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '90000000-0000-0000-0000-000000000002'),
  1,
  'nor leave a second membership'
);

-- The name rule is the index, and the index is the domain's `comparable()`:
-- case and surrounding whitespace are not what makes two names different.
select pg_temp.act_as('90000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), '  priya ') $$,
  'duplicate_name',
  'a name that differs only by case and spacing is a duplicate'
);

select is(pg_temp.invite_uses(pg_temp.circle_id()), 1, 'a refused redemption counts no use');

select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), 'Tom') $$,
  'a free name is accepted'
);

select is(pg_temp.invite_uses(pg_temp.circle_id()), 2, 'and counts its use');

-- A permanent identity joins by link like anyone else: responding never needs a
-- saved place, and having one is not a reason to be turned away (ADR 0004).
select pg_temp.act_as('90000000-0000-0000-0000-000000000005');
select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), 'Sam') $$,
  'a saved-place identity can redeem an invite too'
);

-- ---------------------------------------------------------------------------
-- A removed member, and a live link. Spec §5.2 pairs removal with resetting
-- the link; the link is the capability, so it still works.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update public.circle_members m
set status = 'removed'
from fixture f
where m.circle_id = f.circle_id and m.user_id = '90000000-0000-0000-0000-000000000003';

delete from jobs.outbox where event_name in ('circles.member_joined', 'circles.member_removed');

select pg_temp.act_as('90000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), 'Tom') $$,
  'a removed member redeeming a live link joins again'
);

select is(
  (pg_temp.membership(pg_temp.circle_id(), '90000000-0000-0000-0000-000000000003')).status,
  'active',
  'and is active once more'
);

select is(
  pg_temp.joined_events('90000000-0000-0000-0000-000000000003'),
  1,
  'rejoining announces itself, so the owner is not the last to know'
);

-- ---------------------------------------------------------------------------
-- The cap (ADR 0012). Filled to exactly `member_cap()`, which is the number the
-- domain's `memberLimits.max` carries — not a literal twelve or twenty here,
-- because a test that writes the number down is a test that disagrees with the
-- ADR the day it changes.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select f.circle_id, pg_temp.make_user(
         ('90000000-0000-0000-0000-0000000100' || lpad(n::text, 2, '0'))::uuid,
         'Filler ' || n, true),
       'Filler ' || n
from fixture f,
  generate_series(1, (
    select public.member_cap() - count(*)::integer
    from public.circle_members m, fixture g
    where m.circle_id = g.circle_id and m.status = 'active'
  )) as n;

select is(
  pg_temp.active_members(pg_temp.circle_id()),
  public.member_cap(),
  'the circle now holds exactly the cap'
);

select pg_temp.make_user('90000000-0000-0000-0000-0000000009ff', 'One Too Many', true);
select pg_temp.act_as('90000000-0000-0000-0000-0000000009ff', true);

select throws_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), 'One Too Many') $$,
  'circle_full',
  'the next redemption is refused as circle_full'
);

select is(
  (select count(*)::integer from public.circle_members m
   where m.circle_id = pg_temp.circle_id()
     and m.user_id = '90000000-0000-0000-0000-0000000009ff'),
  0,
  'and writes no membership'
);

select pg_temp.act_as_postgres();

-- Room again, and the same caller gets in: `circle_full` was about the roster,
-- not about them.
update public.circle_members m
set status = 'removed'
from fixture f
where m.circle_id = f.circle_id and m.user_id = '90000000-0000-0000-0000-000000010001';

select pg_temp.act_as('90000000-0000-0000-0000-0000000009ff', true);
select lives_ok(
  $$ select public.redeem_invite(pg_temp.digest_of('live-secret'), 'One Too Many') $$,
  'a seat freed is a seat available'
);

-- ---------------------------------------------------------------------------
-- The Continue-as list (ADR 0006)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
update public.circle_members m set status = 'removed'
from fixture f
where m.circle_id = f.circle_id
  and m.user_id in (select user_id from public.circle_members mm, fixture g
                    where mm.circle_id = g.circle_id
                      and mm.display_name_snapshot like 'Filler %');

select pg_temp.act_as('90000000-0000-0000-0000-000000000004', true);

select bag_eq(
  format($$ select display_name from public.guest_members_for_reattach(%L) $$,
         (select short_code from fixture)),
  $$ values ('Priya'), ('Tom'), ('One Too Many') $$,
  'the list is the circle''s active guests'
);

select isnt_empty(
  format($$ select 1 from public.guest_members_for_reattach(%L) $$, (select short_code from fixture)),
  'a caller with no membership of the circle may still read it — that is the point'
);

select is(
  (select count(*)::integer from public.guest_members_for_reattach((select short_code from fixture))
   where display_name = 'Maya'),
  0,
  'the owner is not on it: a saved place cannot be reattached to'
);

select is(
  (select count(*)::integer from public.guest_members_for_reattach((select short_code from fixture))
   where display_name = 'Sam'),
  0,
  'nor is a saved-place member who joined by link'
);

select is(
  (select count(*)::integer from public.guest_members_for_reattach((select short_code from fixture))
   where display_name = 'Filler 1'),
  0,
  'nor a removed member'
);

-- ADR 0006's one explicit constraint on this function, asserted against the
-- function's own signature rather than against a row: a column that is not
-- returned cannot leak, and a later `select *` cannot quietly add one.
select set_eq(
  $$ select unnest(proargnames) from pg_proc
     where pronamespace = 'public'::regnamespace and proname = 'guest_members_for_reattach'
       and proargmodes is not null $$,
  $$ values ('p_short_code'), ('member_user_id'), ('display_name') $$,
  'it returns a name and an id, and nothing that says whether they have replied'
);

select is(
  (select count(*)::integer from public.guest_members_for_reattach('zzzzzzzzzz')),
  0,
  'an unknown short code is an empty list, not an error that confirms nothing is there'
);

-- ---------------------------------------------------------------------------
-- Who may call what (§14: every definer function has a test that `anon` cannot
-- call it where not intended).
-- ---------------------------------------------------------------------------
select pg_temp.act_as_nobody();

select throws_ok(
  $$ select public.redeem_invite('\x00'::bytea, 'Nobody') $$,
  '42501',
  'permission denied for function redeem_invite',
  'anon cannot redeem an invite: joining needs a session, even an anonymous one'
);

select throws_ok(
  $$ select public.guest_members_for_reattach('abcdefghjk') $$,
  '42501',
  'permission denied for function guest_members_for_reattach',
  'anon cannot read the Continue-as list — the client signs in anonymously first'
);

-- The rest are questions about the catalogue, not about what this caller can
-- do, and `anon` cannot so much as look into `jobs` to ask them.
select pg_temp.act_as_postgres();

select ok(
  not has_function_privilege('anon', 'public.member_cap()', 'execute'),
  'anon cannot read the cap'
);

select ok(
  has_function_privilege('authenticated', 'public.redeem_invite(bytea, text)', 'execute'),
  'an authenticated caller, anonymous or not, can redeem'
);

select ok(
  has_function_privilege('authenticated', 'public.guest_members_for_reattach(text)', 'execute'),
  'and can read the list'
);

select ok(
  not has_function_privilege('authenticated', 'public.begin_request(text, uuid, text, bytea)', 'execute'),
  'the idempotency record is the service role''s alone'
);

select ok(
  not has_function_privilege('authenticated', 'public.take_rate_token(text, bytea, integer, interval)', 'execute'),
  'and so are the rate counters'
);

-- They sit in `public` only because PostgREST exposes nothing else. Being in
-- `public` is not being available, and this is the assertion that says so.
select ok(
  has_function_privilege('service_role', 'public.begin_request(text, uuid, text, bytea)', 'execute'),
  'the service role, and only it, records an idempotent request'
);

select ok(
  not has_table_privilege('authenticated', 'jobs.idempotent_requests', 'select'),
  'no client reads jobs.idempotent_requests'
);

select ok(
  not has_table_privilege('anon', 'jobs.rate_counters', 'select'),
  'no client reads jobs.rate_counters'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'jobs.idempotent_requests'::regclass),
  'and row-level security is on it anyway, with no policy: default deny'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'jobs.rate_counters'::regclass),
  'the same for the counters'
);

-- ---------------------------------------------------------------------------
-- The kit itself, as the service role runs it. These are the only three
-- functions an Edge Function calls that are not about the product, and they are
-- tested here rather than only in the TypeScript suite because this is where
-- they execute: the race `begin_request` closes is a race between two database
-- statements.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.act_as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select pg_temp.act_as_service();

select is(
  (select state from public.begin_request(
     'redeem-invite', '90000000-0000-0000-0000-000000000002', 'key-a',
     pg_temp.digest_of('a body'))),
  'fresh',
  'a key nobody has used is fresh'
);

select is(
  (select state from public.begin_request(
     'redeem-invite', '90000000-0000-0000-0000-000000000002', 'key-a',
     pg_temp.digest_of('a body'))),
  'in_flight',
  'and asking again while the first is still running says so, rather than fresh'
);

select lives_ok(
  $$ select public.finish_request('redeem-invite', '90000000-0000-0000-0000-000000000002',
                                  'key-a', 200, '{"ok": true}'::jsonb) $$,
  'the response is recorded'
);

select is(
  (select response_body from public.begin_request(
     'redeem-invite', '90000000-0000-0000-0000-000000000002', 'key-a',
     pg_temp.digest_of('a body'))),
  '{"ok": true}'::jsonb,
  'so the retry is answered with it instead of doing the work twice'
);

select is(
  (select state from public.begin_request(
     'redeem-invite', '90000000-0000-0000-0000-000000000002', 'key-a',
     pg_temp.digest_of('a different body'))),
  'mismatch',
  'one key and two different bodies is a mismatch, not the first body returned again'
);

select is(
  (select state from public.begin_request(
     'reattach-member', '90000000-0000-0000-0000-000000000002', 'key-a',
     pg_temp.digest_of('a body'))),
  'fresh',
  'the same key in a different function is a different request'
);

select is(
  (select state from public.begin_request(
     'redeem-invite', '90000000-0000-0000-0000-000000000003', 'key-a',
     pg_temp.digest_of('a body'))),
  'fresh',
  'and so is the same key from a different caller — a key is one client''s'
);

-- The limiter. Three allowed, the fourth refused, and the refusal still counted.
select ok(
  public.take_rate_token('redeem_ip', pg_temp.digest_of('203.0.113.7'), 3, interval '1 hour'),
  'the first attempt in the window is within the limit'
);
select ok(
  public.take_rate_token('redeem_ip', pg_temp.digest_of('203.0.113.7'), 3, interval '1 hour'),
  'so is the second'
);
select ok(
  public.take_rate_token('redeem_ip', pg_temp.digest_of('203.0.113.7'), 3, interval '1 hour'),
  'and the third'
);
select ok(
  not public.take_rate_token('redeem_ip', pg_temp.digest_of('203.0.113.7'), 3, interval '1 hour'),
  'the fourth is not'
);
select ok(
  public.take_rate_token('redeem_ip', pg_temp.digest_of('198.51.100.4'), 3, interval '1 hour'),
  'a different key has its own allowance'
);
select ok(
  public.take_rate_token('reattach_ip', pg_temp.digest_of('203.0.113.7'), 3, interval '1 hour'),
  'and so does the same key in a different scope'
);

select is(
  (select count from jobs.rate_counters
   where scope = 'redeem_ip' and key_hash = pg_temp.digest_of('203.0.113.7')),
  4,
  'the refusal was counted too: failing is not a way to stay under a limit'
);

select throws_ok(
  $$ select public.take_rate_token('redeem_ip', '\x00'::bytea, 0, interval '1 hour') $$,
  '22023',
  'take_rate_token needs a positive limit and window',
  'a limit of zero is a programming error, not a permanent refusal'
);

select pg_temp.act_as_postgres();

select * from finish();
rollback;
