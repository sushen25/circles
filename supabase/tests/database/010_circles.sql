-- Identity and circles, from the outside.
--
-- Every assertion here is made as a *client role* with a JWT, not as postgres:
-- a policy tested as a superuser is a policy that was never tested. The point
-- of §14's "pgTAP tests for member/non-member/removed/anonymous/permanent" is
-- that each of those five is a different person, and the database tells them
-- apart on its own.

begin;
select plan(45);

-- ---------------------------------------------------------------------------
-- Fixtures. `handle_new_user()` makes the profile, which is part of what is
-- being tested: nothing below inserts into `public.profiles` by hand.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid
language sql
as $$
  insert into auth.users (
    id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com',
    jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'),
    now(), now()
  )
  returning id;
$$;

/* Become this person: the role a PostgREST request runs as, and their claims. */
create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous
    )::text,
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

select pg_temp.make_user('00000000-0000-0000-0000-00000000a001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a002', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a003', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a009', 'Guest', true);

-- ---------------------------------------------------------------------------
-- The shape.
-- ---------------------------------------------------------------------------

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'circles', 'circles exists');
select has_table('public', 'circle_members', 'circle_members exists');
select has_table('public', 'circle_invites', 'circle_invites exists');
select has_view('public', 'member_profiles', 'member_profiles exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is on for profiles'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.circles'::regclass),
  'RLS is on for circles'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.circle_members'::regclass),
  'RLS is on for circle_members'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.circle_invites'::regclass),
  'RLS is on for circle_invites'
);

-- The signup trigger, not a hand-written insert.
select is(
  (select display_name from public.profiles where user_id = '00000000-0000-0000-0000-00000000a001'),
  'Maya',
  'handle_new_user() created a profile from the auth row'
);
select is(
  (select is_permanent from public.profiles where user_id = '00000000-0000-0000-0000-00000000a001'),
  true,
  'a signed-up user is permanent'
);
select is(
  (select is_permanent from public.profiles where user_id = '00000000-0000-0000-0000-00000000a009'),
  false,
  'an anonymous user is not permanent, and could not have said otherwise'
);

-- ---------------------------------------------------------------------------
-- The organiser gate (ADR 0004).
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a009', true);
select is(public.auth_is_permanent(), false, 'a guest has no saved place');
select throws_ok(
  $$select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne')$$,
  '42501',
  'creating a circle needs a saved place',
  'an anonymous identity cannot create a circle'
);

select pg_temp.act_as_nobody();
select is(public.auth_is_permanent(), false, 'a caller with no JWT at all is not permanent');

-- ---------------------------------------------------------------------------
-- Creating a circle.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
select is(public.auth_is_permanent(), true, 'a saved place is a saved place');

select lives_ok(
  $$select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'monthly')$$,
  'a permanent identity can create a circle'
);

select is(
  (select count(*)::integer from public.circles where name = 'Sunday Crew'),
  1,
  'and can see the circle they just made'
);
select is(
  (select role from public.circle_members m
   join public.circles c on c.id = m.circle_id
   where c.name = 'Sunday Crew' and m.user_id = '00000000-0000-0000-0000-00000000a001'),
  'owner',
  'the creator is the owner, and a member, in the same transaction'
);
select isnt(
  (select short_code from public.circles where name = 'Sunday Crew'),
  null,
  'the circle has a short code'
);

-- ---------------------------------------------------------------------------
-- Who can see a circle.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
create temporary table t_circle as
  select id from public.circles where name = 'Sunday Crew';
-- A test fixture, not product data: the client roles need to read it to ask
-- the questions below as themselves.
grant select on t_circle to anon, authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select id, '00000000-0000-0000-0000-00000000a002', 'Priya' from t_circle;

select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select is(
  (select count(*)::integer from public.circles),
  1,
  'a member sees the circle they were added to'
);
select is(
  public.auth_is_member((select id from t_circle)),
  true,
  'auth_is_member says so'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select is((select count(*)::integer from public.circles), 0, 'a non-member sees nothing');
select is(
  public.auth_is_member((select id from t_circle)),
  false,
  'and auth_is_member agrees'
);
select is(
  (select count(*)::integer from public.circle_members),
  0,
  'a non-member cannot read the roster either'
);

-- A removed member is not a member. This is the case a `delete` would have got
-- wrong: the row is kept so attendance history survives.
select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-00000000a002';

select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select is((select count(*)::integer from public.circles), 0, 'a removed member sees nothing');
select is(
  public.auth_is_member((select id from t_circle)),
  false,
  'auth_is_member is false for a removed member'
);

select pg_temp.act_as_postgres();
update public.circle_members set status = 'active'
where user_id = '00000000-0000-0000-0000-00000000a002';

-- ---------------------------------------------------------------------------
-- Settings: the owner's, and nobody else's.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
update public.circles set cadence = 'fortnightly' where id = (select id from t_circle);
select is(
  (select cadence from public.circles where id = (select id from t_circle)),
  'fortnightly',
  'the owner can change the cadence'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
update public.circles set cadence = 'weekly' where id = (select id from t_circle);
select is(
  (select cadence from public.circles where id = (select id from t_circle)),
  'fortnightly',
  'a member cannot: the update matches no row rather than raising'
);

-- Handing the circle over is its own operation, with its own checks. Doing it
-- by `update circles set owner_user_id` would skip them all.
select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
select throws_ok(
  format(
    $$update public.circles set owner_user_id = '%s' where id = '%s'$$,
    '00000000-0000-0000-0000-00000000a002', (select id from t_circle)
  ),
  '42501',
  null,
  'not even the owner can reassign ownership by updating the row'
);
select throws_ok(
  format($$update public.circles set short_code = 'stolen' where id = '%s'$$, (select id from t_circle)),
  '42501',
  null,
  'nor rewrite the short code'
);

-- ---------------------------------------------------------------------------
-- A member may change their own mutes, and nothing else.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
update public.circle_members set muted_quiet_asks = true
where user_id = '00000000-0000-0000-0000-00000000a002';
select is(
  (select muted_quiet_asks from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000a002'),
  true,
  'a member can mute quiet asks for themselves'
);

select throws_ok(
  $$update public.circle_members set role = 'owner'
    where user_id = '00000000-0000-0000-0000-00000000a002'$$,
  '42501',
  null,
  'and cannot promote themselves to owner through the same policy'
);
select throws_ok(
  $$update public.circle_members set status = 'active', display_name_snapshot = 'Someone Else'
    where user_id = '00000000-0000-0000-0000-00000000a002'$$,
  '42501',
  null,
  'nor rewrite the name history keeps'
);

update public.circle_members set muted_all = true
where user_id = '00000000-0000-0000-0000-00000000a001';
select is(
  (select muted_all from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000a001'),
  false,
  'and cannot mute somebody else'
);

-- ---------------------------------------------------------------------------
-- The member cap.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
do $$
declare
  circle uuid := (select id from t_circle);
  i integer;
  member_id uuid;
begin
  -- Two members already. Ten more makes twelve.
  for i in 3..12 loop
    member_id := ('00000000-0000-0000-0000-00000000c0' || lpad(i::text, 2, '0'))::uuid;
    perform pg_temp.make_user(member_id, 'Member ' || i);
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values (circle, member_id, 'Member ' || i);
  end loop;
end;
$$;

select is(
  (select count(*)::integer from public.circle_members
   where circle_id = (select id from t_circle) and status = 'active'),
  12,
  'twelve active members is allowed'
);

select pg_temp.make_user('00000000-0000-0000-0000-00000000cf13', 'Thirteen');
select throws_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'Thirteen')$$,
    (select id from t_circle), '00000000-0000-0000-0000-00000000cf13'
  ),
  '23514',
  null,
  'the thirteenth is refused'
);

-- Removing somebody makes room, which is the point of a cap on *active*
-- members rather than on rows.
update public.circle_members set status = 'removed'
where circle_id = (select id from t_circle)
  and user_id = '00000000-0000-0000-0000-00000000c012';
select lives_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'Thirteen')$$,
    (select id from t_circle), '00000000-0000-0000-0000-00000000cf13'
  ),
  'and allowed once a seat is free'
);

-- ---------------------------------------------------------------------------
-- Invites: nothing, to anyone.
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.circle_invites', 'select'),
  'anon cannot select circle_invites'
);
select ok(
  not has_table_privilege('authenticated', 'public.circle_invites', 'select'),
  'authenticated cannot select circle_invites either — the hash is the one thing worth stealing'
);
select ok(
  not has_table_privilege('authenticated', 'public.circle_invites', 'insert'),
  'nor insert one'
);

-- ---------------------------------------------------------------------------
-- Profiles, and the names other people may see.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select is(
  (select count(*)::integer from public.profiles),
  1,
  'a member sees exactly one profile: their own'
);

select is(
  (select count(*)::integer from public.member_profiles
   where user_id = '00000000-0000-0000-0000-00000000a001'),
  1,
  'and sees a co-member’s current name through member_profiles'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000a009', true);
select is(
  (select count(*)::integer from public.member_profiles),
  0,
  'somebody who shares no circle sees no names at all'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select throws_ok(
  $$update public.profiles set is_permanent = true
    where user_id = '00000000-0000-0000-0000-00000000a002'$$,
  '42501',
  null,
  'nobody promotes themselves to a saved place by updating a row'
);

select * from finish();
rollback;
