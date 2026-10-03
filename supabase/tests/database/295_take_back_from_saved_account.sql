-- An emailed re-entry link may take a place back from a saved account when the
-- account's own email is not the link's address (SUS-103, ADR 0048 decision 6;
-- the founder's decision of 3 October 2026).
--
-- The story: somebody picks a guest from the Continue-as list, then saves the place
-- as an account, in place (`linkIdentity`) or through `claim_identity`. The real
-- guest's link used to answer "that place belongs to an account". Each scene below
-- builds that story in its own circle, as the roles a client really has, and then
-- asserts what the link does.
--
--   1  in place, a different address     takes the place back; the account keeps all else
--   2  through claim_identity            a link `retire_reentry_links` spent still works, once
--   3  the account's own address         keeps the place
--   4  the same address, by case only    keeps the place
--   5  an account with no address        the link takes the place back
--   6  the address is on an identity     keeps the place
--   7  a link that was already used      cannot take anything back
--   8  the circle's owner                keeps the place
--   9  a profile flag and no account     keeps the place
--
-- Maya (k=4 of each scene) owns the circle; the guest is k=1, the taker k=2, the
-- guest's fresh session k=3, a second account k=5.

begin;
select plan(66);

create or replace function pg_temp.uid(n integer, k integer) returns uuid
language sql immutable as $$
  select ('29500000-0000-0000-' || lpad(n::text, 4, '0') || '-' || lpad(k::text, 12, '0'))::uuid
$$;

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false,
                                             email text default null)
returns uuid
language sql
as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    email, anonymous,
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

create or replace function pg_temp.digest_of(secret text) returns bytea
language sql as $$ select extensions.digest(secret, 'sha256') $$;

create temporary table scenes (n integer primary key, circle_id uuid, other_id uuid, plan_id uuid);
grant select on scenes to authenticated;

create or replace function pg_temp.circle(n integer) returns uuid
language sql as $$ select circle_id from scenes where n = $1 $$;
create or replace function pg_temp.other(n integer) returns uuid
language sql as $$ select other_id from scenes where n = $1 $$;

-- Maya's circle with the real guest in it, who has a verified address and a link
-- (`link-N`), and a second circle ("Other") the taker belongs to as a guest.
create or replace function pg_temp.base(n integer) returns void
language plpgsql as $$
declare
  c uuid;
  o uuid;
  p uuid;
begin
  perform pg_temp.act_as_postgres();
  perform pg_temp.make_user(pg_temp.uid(n, 4), 'Maya ' || n, false, 'maya-' || n || '@example.com');
  perform pg_temp.make_user(pg_temp.uid(n, 1), 'Guest ' || n, true);
  perform pg_temp.make_user(pg_temp.uid(n, 2), 'Taker ' || n, true);
  perform pg_temp.make_user(pg_temp.uid(n, 3), 'Fresh ' || n, true);

  perform pg_temp.act_as(pg_temp.uid(n, 4));
  select id into c from public.create_circle('Crew ' || n, 'sky', 'Australia/Melbourne', 'sus103b-c' || n);
  select id into o from public.create_circle('Other ' || n, 'sky', 'Australia/Melbourne', 'sus103b-o' || n);
  perform pg_temp.act_as_postgres();

  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  )
  values (c, 'named', 'collecting', pg_temp.uid(n, 4), 'Catch up', 'Australia/Melbourne',
          date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
          timestamptz '2099-09-20T10:00:00Z', 'kvpqma' || (n + 1)::text || 'x')
  returning id into p;

  insert into scenes values (n, c, o, p);

  insert into public.circle_members (circle_id, user_id, display_name_snapshot)
  values (c, pg_temp.uid(n, 1), 'Guest ' || n),
         (o, pg_temp.uid(n, 2), 'Taker ' || n);

  insert into private.email_contacts (user_id, email_normalized, status, verified_at)
  values (pg_temp.uid(n, 1), 'guest-' || n || '@example.com', 'verified', now() - interval '1 day'),
         (pg_temp.uid(n, 2), 'taker-other-' || n || '@example.com', 'verified', now() - interval '1 day');

  perform public.issue_reentry_token(c,
    (select id from private.email_contacts where email_normalized = 'guest-' || n || '@example.com'),
    pg_temp.digest_of('link-' || n));
  perform public.issue_reentry_token(o,
    (select id from private.email_contacts where email_normalized = 'taker-other-' || n || '@example.com'),
    pg_temp.digest_of('other-link-' || n));
end;
$$;

-- The taker picks the guest from the list, attaches an address and a subscription
-- of their own to the place they now hold, and saves it as an account.
create or replace function pg_temp.take_and_save(n integer, account_email text, mode text)
returns void
language plpgsql as $$
declare
  holder uuid := pg_temp.uid(n, 2);
  acct uuid;
begin
  perform pg_temp.act_as(pg_temp.uid(n, 2), true);
  perform public.reattach_member(pg_temp.circle(n), pg_temp.uid(n, 1));
  perform pg_temp.act_as_postgres();

  insert into private.email_contacts (user_id, email_normalized, status, verified_at)
  values (holder, 'acct-' || n || '@example.com', 'verified', now());
  insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
  select id, holder, 'plan_updates', (select plan_id from scenes where scenes.n = $1), 'v1'
  from private.email_contacts where email_normalized = 'acct-' || n || '@example.com';
  perform public.issue_reentry_token(pg_temp.circle(n),
    (select id from private.email_contacts where email_normalized = 'acct-' || n || '@example.com'),
    pg_temp.digest_of('acct-link-' || n));

  if mode = 'inplace' then
    update auth.users
    set is_anonymous = false, email = account_email, raw_app_meta_data = '{"is_anonymous": false}'
    where id = holder;
    update public.profiles set is_permanent = true where user_id = holder;
    acct := holder;
  else
    acct := pg_temp.uid(n, 5);
    perform pg_temp.make_user(acct, 'Account ' || n, false, account_email);
    perform public.claim_identity(acct, holder, 'reattached');
  end if;
end;
$$;

create or replace function pg_temp.holder(n integer) returns uuid
language sql as $$
  select user_id from public.circle_members
  where circle_id = pg_temp.circle(n) and display_name_snapshot = 'Guest ' || n and status = 'active'
$$;

-- ===========================================================================
-- 1  In place, a different address: the link takes the place back
-- ===========================================================================
select pg_temp.base(1);
select pg_temp.take_and_save(1, 'taker-account-1@example.com', 'inplace');
select pg_temp.act_as_postgres();

select is(pg_temp.holder(1), pg_temp.uid(1, 2), '1: the taker holds the place and has saved it');
select is(private.list_moves_this_week(pg_temp.circle(1), pg_temp.uid(1, 2)), 1, '1: one list move so far');

select pg_temp.act_as(pg_temp.uid(1, 3), true);
select is(
  (select id from public.reattach_member(p_reentry_token_hash => pg_temp.digest_of('link-1'))),
  pg_temp.circle(1),
  '1: the real guest''s link takes the place back from the account'
);
select pg_temp.act_as_postgres();

select is(pg_temp.holder(1), pg_temp.uid(1, 3), '1: the place is the fresh session''s');
select is(
  (select count(*)::integer from public.circle_members
   where circle_id = pg_temp.circle(1) and user_id = pg_temp.uid(1, 2)),
  0,
  '1: and the account no longer has a membership in that circle'
);
select is(
  (select count(*)::integer from public.circle_members
   where circle_id = pg_temp.other(1) and user_id = pg_temp.uid(1, 2) and status = 'active'),
  1,
  '1: but its membership of its other circle is untouched'
);
select is(
  (select count(*)::integer from public.circle_members where circle_id = pg_temp.circle(1)),
  2,
  '1: the circle has Maya and the guest, and nobody was removed or duplicated'
);
select is(
  (select user_id from private.email_contacts where email_normalized = 'guest-1@example.com'),
  pg_temp.uid(1, 3),
  '1: the link''s address travelled with the place'
);
select is(
  (select user_id from private.email_contacts where email_normalized = 'acct-1@example.com'),
  pg_temp.uid(1, 2),
  '1: the account''s own address stayed with the account'
);
select is(
  (select s.user_id from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id where c.email_normalized = 'acct-1@example.com'),
  pg_temp.uid(1, 2),
  '1: and so did its consent'
);
select is(
  (select count(*)::integer from private.email_action_tokens
   where token_hash = pg_temp.digest_of('acct-link-1')),
  0,
  '1: the account''s other link for this circle is gone, not handed to anybody'
);
select is(
  (select count(*)::integer from private.email_action_tokens
   where token_hash = pg_temp.digest_of('other-link-1')),
  1,
  '1: its link for its other circle is not'
);
select ok(
  (select used_at is not null and retired_at is null from private.email_action_tokens
   where token_hash = pg_temp.digest_of('link-1')),
  '1: the link is spent by use'
);
select is(
  (select metadata ->> 'source' || '/' || (metadata ->> 'from_saved_account') from private.audit_log
   where action = 'circles.member_reattached' and resource_id = pg_temp.circle(1)
   order by occurred_at desc, id desc limit 1),
  'email/true',
  '1: the audit row says it was an emailed move from a saved account'
);
select is(
  (select payload ->> 'from_user_id' from jobs.outbox
   where event_name = 'circles.member_reattached' and aggregate_id = pg_temp.circle(1)
   order by created_at desc, id desc limit 1),
  pg_temp.uid(1, 2)::text,
  '1: the member_reattached event names the account the place came from, so both parties are told the same way'
);
select is(private.list_moves_this_week(pg_temp.circle(1), pg_temp.uid(1, 3)), 1,
  '1: the take-back did not count toward the weekly cap');

-- What the account holder sees afterwards, as that account.
select pg_temp.act_as(pg_temp.uid(1, 2));
select is((select count(*)::integer from public.circles where id = pg_temp.circle(1)), 0,
  '1: the account can no longer read the circle');
select is((select count(*)::integer from public.circles where id = pg_temp.other(1)), 1,
  '1: and still reads its other one');

-- Replaying the same link
select pg_temp.act_as_postgres();
select pg_temp.make_user(pg_temp.uid(1, 6), 'Late', true);
select pg_temp.act_as(pg_temp.uid(1, 6), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('link-1', 'sha256')) $$,
  'token_invalid',
  '1: the spent link cannot be used again'
);

-- ===========================================================================
-- 2  Through claim_identity: the link `retire_reentry_links` spent still works, once
-- ===========================================================================
select pg_temp.act_as_postgres();
select pg_temp.base(2);
select pg_temp.take_and_save(2, 'existing-account-2@example.com', 'claim');
select pg_temp.act_as_postgres();

select is(pg_temp.holder(2), pg_temp.uid(2, 5), '2: the existing account now holds the place');
select ok(
  (select used_at is not null and retired_at is not null from private.email_action_tokens
   where token_hash = pg_temp.digest_of('link-2')),
  '2: the guest''s link was spent by the claim, and marked retired'
);

select pg_temp.act_as(pg_temp.uid(2, 3), true);
select is(
  (select id from public.reattach_member(p_reentry_token_hash => pg_temp.digest_of('link-2'))),
  pg_temp.circle(2),
  '2: the retired link takes the place back'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder(2), pg_temp.uid(2, 3), '2: the place is the fresh session''s');
select ok(
  (select used_at is not null and retired_at is null from private.email_action_tokens
   where token_hash = pg_temp.digest_of('link-2')),
  '2: and the link is now spent by use, so it works once');
select is(
  (select user_id from private.email_contacts where email_normalized = 'acct-2@example.com'),
  pg_temp.uid(2, 5),
  '2: the account''s address that came with the claim stayed with the account');

select pg_temp.act_as_postgres();
select pg_temp.make_user(pg_temp.uid(2, 6), 'Late', true);
select pg_temp.act_as(pg_temp.uid(2, 6), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('link-2', 'sha256')) $$,
  'token_invalid',
  '2: a second use is refused'
);

-- ===========================================================================
-- 3  The account's own address is the link's address: it is the same person
-- ===========================================================================
select pg_temp.act_as_postgres();
select pg_temp.base(3);
select pg_temp.take_and_save(3, 'guest-3@example.com', 'inplace');
select pg_temp.act_as(pg_temp.uid(3, 3), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('link-3', 'sha256')) $$,
  'target_is_permanent',
  '3: an account whose own email is the link''s address keeps the place'
);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle(3), pg_temp.uid(3, 2)) $$,
  'target_is_permanent',
  '3: and a pick from the list still never moves a saved place'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder(3), pg_temp.uid(3, 2), '3: nothing moved');
select ok((select used_at is null from private.email_action_tokens where token_hash = pg_temp.digest_of('link-3')),
  '3: and the refusal did not spend the link');

-- ===========================================================================
-- 4  The same address, by case only
-- ===========================================================================
select pg_temp.base(4);
select pg_temp.take_and_save(4, 'Guest-4@EXAMPLE.com', 'inplace');
select pg_temp.act_as(pg_temp.uid(4, 3), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('link-4', 'sha256')) $$,
  'target_is_permanent',
  '4: an address that differs only by case is the same address, and the account keeps the place'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder(4), pg_temp.uid(4, 2), '4: nothing moved');

-- ===========================================================================
-- 5  An account with no address of its own
-- ===========================================================================
select pg_temp.base(5);
select pg_temp.take_and_save(5, null, 'inplace');
select pg_temp.act_as(pg_temp.uid(5, 3), true);
select is(
  (select id from public.reattach_member(p_reentry_token_hash => pg_temp.digest_of('link-5'))),
  pg_temp.circle(5),
  '5: an account with no email of its own has none to match, so the link takes the place back'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder(5), pg_temp.uid(5, 3), '5: the place moved');

-- ===========================================================================
-- 6  The address is on one of the account's sign-in identities
-- ===========================================================================
select pg_temp.base(6);
select pg_temp.take_and_save(6, 'taker-primary-6@example.com', 'inplace');
insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
values (gen_random_uuid(), 'google-6', pg_temp.uid(6, 2),
        jsonb_build_object('sub', 'google-6', 'email', 'GUEST-6@example.com'), 'google', now(), now());
select pg_temp.act_as(pg_temp.uid(6, 3), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('link-6', 'sha256')) $$,
  'target_is_permanent',
  '6: an address on any of the account''s identities is the account''s own'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder(6), pg_temp.uid(6, 2), '6: nothing moved');

-- ===========================================================================
-- 7  A link that already moved a place cannot take one back
-- ===========================================================================
select pg_temp.base(7);
select pg_temp.act_as(pg_temp.uid(7, 2), true);
select public.reattach_member(pg_temp.circle(7), pg_temp.uid(7, 1));
select pg_temp.act_as(pg_temp.uid(7, 3), true);
select public.reattach_member(p_reentry_token_hash => pg_temp.digest_of('link-7'));
select pg_temp.act_as_postgres();
select is(pg_temp.holder(7), pg_temp.uid(7, 3), '7: the guest used the link legitimately');
-- and later saves the place under a different address
update auth.users
set is_anonymous = false, email = 'relay-7@example.com', raw_app_meta_data = '{"is_anonymous": false}'
where id = pg_temp.uid(7, 3);
update public.profiles set is_permanent = true where user_id = pg_temp.uid(7, 3);
select pg_temp.make_user(pg_temp.uid(7, 6), 'Forwarded', true);
select pg_temp.act_as(pg_temp.uid(7, 6), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('link-7', 'sha256')) $$,
  'target_is_permanent',
  '7: the same link, forwarded and replayed, takes nothing from the account it already served'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder(7), pg_temp.uid(7, 3), '7: nothing moved');

-- ===========================================================================
-- 8  The circle's owner is never moved by a link
-- ===========================================================================
select pg_temp.base(8);
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values (pg_temp.uid(8, 4), 'maya-guest-address-8@example.com', 'verified', now());
insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at, used_at, retired_at,
                                          membership_circle_id, membership_user_id)
select c.id, 'reentry', pg_temp.digest_of('owner-link-8'), now() + interval '1 day', now(), now(),
       pg_temp.circle(8), pg_temp.uid(8, 4)
from private.email_contacts c where c.email_normalized = 'maya-guest-address-8@example.com';
select pg_temp.act_as(pg_temp.uid(8, 3), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('owner-link-8', 'sha256')) $$,
  'target_is_permanent',
  '8: a link cannot take a circle''s owner out of it'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from public.circle_members
   where circle_id = pg_temp.circle(8) and user_id = pg_temp.uid(8, 4) and status = 'active'),
  1,
  '8: the owner is still a member'
);

-- ===========================================================================
-- 9  A profile that says "permanent" while the auth record does not
-- ===========================================================================
select pg_temp.base(9);
select pg_temp.act_as(pg_temp.uid(9, 2), true);
select public.reattach_member(pg_temp.circle(9), pg_temp.uid(9, 1));
select pg_temp.act_as_postgres();
update public.profiles set is_permanent = true where user_id = pg_temp.uid(9, 2);
select pg_temp.act_as(pg_temp.uid(9, 3), true);
select throws_ok(
  $$ select public.reattach_member(p_reentry_token_hash => extensions.digest('link-9', 'sha256')) $$,
  'target_is_permanent',
  '9: only the auth record can say a holder is an account; a flag on its own is a no'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder(9), pg_temp.uid(9, 2), '9: nothing moved');

select * from finish();
rollback;
