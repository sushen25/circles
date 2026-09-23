-- Identity and circles, from the outside.
--
-- Every assertion here is made as a *client role* with a JWT, not as postgres:
-- a policy tested as a superuser is a policy that was never tested. The point
-- of §14's "pgTAP tests for member/non-member/removed/anonymous/permanent" is
-- that each of those five is a different person, and the database tells them
-- apart on its own.

begin;
select plan(90);

-- ---------------------------------------------------------------------------
-- Fixtures. `handle_new_user()` makes the profile, which is part of what is
-- being tested: nothing below inserts into `public.profiles` by hand.
-- ---------------------------------------------------------------------------

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
    id::text || '@example.com',
    anonymous,
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
  $$select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-sunday')$$,
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
  $$select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-sunday', 'monthly')$$,
  'a permanent identity can create a circle'
);

select is(
  (select count(*)::integer from public.circles where creation_key = 'key-sunday'),
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
  (select short_code from public.circles where creation_key = 'key-sunday'),
  null,
  'the circle has a short code'
);

-- ---------------------------------------------------------------------------
-- Who can see a circle.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
create temporary table t_circle as
  select id from public.circles where creation_key = 'key-sunday';
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
  -- Two members already. Fill to exactly the cap, whatever the cap is: reading
  -- `member_cap()` rather than retyping the number is what stops this test and
  -- the domain's `memberLimits.max` drifting apart in silence.
  for i in 3..public.member_cap() loop
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
  public.member_cap(),
  'a circle fills to exactly the cap'
);
select is(public.member_cap(), 20, 'and the cap is twenty (ADR 0012)');

select pg_temp.make_user('00000000-0000-0000-0000-00000000cf13', 'One Too Many');
select throws_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'One Too Many')$$,
    (select id from t_circle), '00000000-0000-0000-0000-00000000cf13'
  ),
  '23514',
  null,
  'the one after the cap is refused'
);

-- Removing somebody makes room, which is the point of a cap on *active*
-- members rather than on rows.
update public.circle_members set status = 'removed'
where circle_id = (select id from t_circle)
  and user_id = ('00000000-0000-0000-0000-00000000c0' || lpad(public.member_cap()::text, 2, '0'))::uuid;
select lives_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'One Too Many')$$,
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

-- ---------------------------------------------------------------------------
-- Short codes are the ones the routes accept.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select matches(
  (select short_code from public.circles where id = (select id from t_circle)),
  '^[a-hjkmnp-z2-9]{6,12}$',
  'the generated short code satisfies the ShortCode contract'
);
select throws_ok(
  format(
    $$update public.circles set short_code = 'l0okalike' where id = '%s'$$,
    (select id from t_circle)
  ),
  '23514',
  null,
  'a code with characters that look like each other is refused'
);

-- ---------------------------------------------------------------------------
-- A time zone is one the database knows.
--
-- `create_circle` is reached by RPC, so the Zod contract on the way in can be
-- skipped entirely; every member of the circle would then hit a formatting
-- error on a value one person typed.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select throws_ok(
  $$select public.create_circle('Mars Crew', 'sky', 'Mars/Olympus', 'key-mars')$$,
  '23514',
  'Mars/Olympus is not an IANA time zone',
  'a zone nobody has heard of is refused at the boundary'
);
select lives_ok(
  $$select public.create_circle('Kathmandu Crew', 'sky', 'Asia/Kathmandu', 'key-kathmandu')$$,
  'and a real one, three quarters of an hour off the hour, is fine'
);

-- ---------------------------------------------------------------------------
-- Two active members of one circle cannot share a name.
--
-- In the database, because two people redeeming an invite at once is exactly
-- when an application-level check loses.
-- ---------------------------------------------------------------------------

-- On the Kathmandu circle, which Tom owns and has room in — the Sunday Crew is
-- full by this point in the file.
select pg_temp.act_as_postgres();
create temporary table t_other as
  select id from public.circles where name = 'Kathmandu Crew';
grant select on t_other to anon, authenticated;

select pg_temp.make_user('00000000-0000-0000-0000-00000000d001', 'Tom Again');
select throws_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', '  tom ')$$,
    (select id from t_other), '00000000-0000-0000-0000-00000000d001'
  ),
  '23505',
  null,
  'a second Tom is refused, whatever the case and spacing'
);
select lives_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'Tam')$$,
    (select id from t_other), '00000000-0000-0000-0000-00000000d001'
  ),
  'a different name is fine'
);

-- …and the name is freed when the first one leaves, because the index is on
-- active memberships rather than on rows.
savepoint before_name_reuse;
select pg_temp.make_user('00000000-0000-0000-0000-00000000d002', 'Third');
update public.circle_members set status = 'removed'
where circle_id = (select id from t_other)
  and user_id = '00000000-0000-0000-0000-00000000d001';
select lives_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'Tam')$$,
    (select id from t_other), '00000000-0000-0000-0000-00000000d002'
  ),
  'and freed once the first one leaves'
);
rollback to savepoint before_name_reuse;

-- ---------------------------------------------------------------------------
-- A rename cannot smuggle a duplicate past the index.
--
-- The roster shows the snapshot and `member_profiles` shows the profile, so a
-- rename that only touched the profile would have shown two people with one
-- name while the index saw nothing change.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
update public.profiles set display_name = 'Prya'
where user_id = '00000000-0000-0000-0000-00000000a002';
select is(
  (select display_name_snapshot from public.circle_members
   where circle_id = (select id from t_circle)
     and user_id = '00000000-0000-0000-0000-00000000a002'),
  'Prya',
  'an active membership follows the profile name'
);

select throws_ok(
  $$update public.profiles set display_name = 'Maya'
    where user_id = '00000000-0000-0000-0000-00000000a002'$$,
  '23505',
  null,
  'and cannot be renamed to a co-member’s name'
);

savepoint before_removed_rename;
update public.circle_members set status = 'removed'
where circle_id = (select id from t_circle)
  and user_id = '00000000-0000-0000-0000-00000000a002';
update public.profiles set display_name = 'Somebody Else'
where user_id = '00000000-0000-0000-0000-00000000a002';
select is(
  (select display_name_snapshot from public.circle_members
   where circle_id = (select id from t_circle)
     and user_id = '00000000-0000-0000-0000-00000000a002'),
  'Prya',
  'a removed membership keeps the name it had — the snapshot stops following'
);
rollback to savepoint before_removed_rename;

-- ---------------------------------------------------------------------------
-- Creating a circle twice.
--
-- The client cannot tell a timeout from a failure, and a person who taps again
-- should not end up with two circles and no way to know which one they gave
-- the link out for.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select is(
  (select (public.create_circle('Twice', 'sky', 'Australia/Melbourne', 'key-1')).id),
  (select (public.create_circle('Twice', 'sky', 'Australia/Melbourne', 'key-1')).id),
  'the same idempotency key returns the same circle'
);
select is(
  (select count(*)::integer from public.circles where name = 'Twice'),
  1,
  'and makes exactly one'
);
select isnt(
  (select (public.create_circle('Twice', 'sky', 'Australia/Melbourne', 'key-2')).id),
  (select id from public.circles where name = 'Twice' and creation_key = 'key-1'),
  'a different key is a different circle, because it is a different intention'
);

-- ---------------------------------------------------------------------------
-- The database's idea of a duplicate name is the domain's idea of one.
--
-- Lowercasing and trimming alone let "Tom  B" sit beside "Tom B" and "Zoë"
-- beside "Zoe" — both duplicates by `comparable()` in
-- `packages/domain/src/circles/display-name.ts`. An index that is almost the
-- rule is not the rule, and the disagreement is silent: the domain refuses a
-- name the database has already stored.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select is(public.canonical_display_name('Tom  B'), 'tom b', 'inner runs of space collapse');
select is(public.canonical_display_name(E'Tom\tB'), 'tom b', 'a tab is whitespace too');
select is(public.canonical_display_name('  Priya '), 'priya', 'and the ends are trimmed');
select is(public.canonical_display_name('Zoë'), 'zoe', 'diacritics do not make a different person');
select is(public.canonical_display_name(E'Zo\u0308e'), 'zoe', 'however the accent was typed');
select is(public.canonical_display_name(E'A\u00a0B'), 'a b', 'a non-breaking space is a space');

-- Marks outside the Latin block, which is where the two engines used to part
-- company: `\p{Diacritic}` in the domain removed Hebrew points and Arabic
-- harakat, and the SQL class did not, so the database stored pairs the domain
-- called duplicates. The class is enumerated identically on both sides now, and
-- these are the same pairs `display-name.test.ts` asserts.
select is(
  public.canonical_display_name(E'\u05e9\u05b8\u05c1\u05dc\u05d5\u05b9\u05dd'),
  public.canonical_display_name(E'\u05e9\u05dc\u05d5\u05dd'),
  'a pointed Hebrew name is the unpointed one'
);
select is(
  public.canonical_display_name(E'\u0645\u064f\u062d\u064e\u0645\u0651\u064e\u062f'),
  public.canonical_display_name(E'\u0645\u062d\u0645\u062f'),
  'and an Arabic name with harakat is the one without'
);
select is(public.canonical_display_name('   '), '', 'a name of nothing is nothing');

select pg_temp.act_as_postgres();
select pg_temp.make_user('00000000-0000-0000-0000-00000000e001', 'Spacer');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e003', 'Spacer Two');
select lives_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'Sam  W')$$,
    (select id from t_other), '00000000-0000-0000-0000-00000000e001'
  ),
  'a two-word name goes in'
);
select throws_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'Sam W')$$,
    (select id from t_other), '00000000-0000-0000-0000-00000000e003'
  ),
  '23505',
  null,
  'and a name that differs from it only in spacing is the same name'
);

select pg_temp.make_user('00000000-0000-0000-0000-00000000e002', 'Accent');
select throws_ok(
  format(
    $$insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values ('%s', '%s', 'Tåm')$$,
    (select id from t_other), '00000000-0000-0000-0000-00000000e002'
  ),
  '23505',
  null,
  'and one that differs only in accents'
);

-- ---------------------------------------------------------------------------
-- A name has to be a name.
--
-- `authenticated` may update `display_name` directly, and `sync_member_names`
-- pushes it to every active membership: a blank here is a blank roster entry
-- for the whole circle.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.profiles set display_name = '   '
    where user_id = '00000000-0000-0000-0000-00000000a002'$$,
  '23514',
  null,
  'a name of nothing but spaces is refused'
);
select throws_ok(
  $$update public.profiles set display_name = E'\t\n '
    where user_id = '00000000-0000-0000-0000-00000000a002'$$,
  '23514',
  null,
  'tabs and newlines are not a name either'
);

-- ---------------------------------------------------------------------------
-- Zones the client's runtime also calls zones.
--
-- `pg_timezone_names` and `Intl.DateTimeFormat` are not the same set in either
-- direction: Postgres has `Factory` and the `posix/…` family, which `Intl`
-- refuses, and `Intl` accepts lowercase names an exact-match lookup would not.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select throws_ok(
  $$select public.create_circle('Factory Crew', 'sky', 'Factory', 'key-factory')$$,
  '23514',
  null,
  'a tzdata compatibility entry is not a time zone'
);
select throws_ok(
  $$select public.create_circle('Posix Crew', 'sky', 'posix/Australia/Melbourne', 'key-posix')$$,
  '23514',
  null,
  'nor is a posix/ alias, which the client runtime would refuse to format'
);
select lives_ok(
  $$select public.create_circle('Lower Crew', 'sky', 'australia/melbourne', 'key-lower')$$,
  'a lowercase name is accepted, because the client contract accepts it'
);
select is(
  (select time_zone from public.circles where name = 'Lower Crew'),
  'Australia/Melbourne',
  'and stored in the spelling every runtime recognises'
);

-- The exclusion list was measured, not guessed: every name in this tzdata's
-- `pg_timezone_names` was passed through Node's `Intl.DateTimeFormat`, and the
-- ones it refused were exactly `Factory` and the `posix/…` family (`right/` is
-- excluded for the same reason and is absent from this build). That check
-- cannot live here, because pgTAP has no `Intl` — so what is asserted is the
-- rule's behaviour on the named cases, and the residual risk is a future tzdata
-- adding a family nobody re-diffed. Worth redoing when Postgres is upgraded.

-- ---------------------------------------------------------------------------
-- Creating a circle needs an idempotency key.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select throws_ok(
  $$select public.create_circle('Keyless', 'sky', 'Australia/Melbourne', null)$$,
  '22004',
  null,
  'a creation with no key is refused, because an optional key is a key nobody sends'
);
select throws_ok(
  $$select public.create_circle('Keyless', 'sky', 'Australia/Melbourne', '  ')$$,
  '22004',
  null,
  'and neither is a blank one'
);

-- ---------------------------------------------------------------------------
-- An owner stays a member.
--
-- Watching `circles` alone made this true only at the moment of creation:
-- removing the owner's membership later left the circle owned by nobody, with
-- `auth_is_owner` false for good and every owner-only operation refused.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();

-- The check is deferred to commit, and these tests never commit. Forcing it
-- immediate inside the helper is how a rolled-back transaction can still see
-- what a real one would have hit.
create or replace function pg_temp.remove_member(circle uuid, member uuid, hard boolean default false)
returns void
language plpgsql
as $$
begin
  -- Discharge whatever the fixtures queued — `create_circle` left a deferred
  -- check holding the owner it saw — then defer again, so what fires below is
  -- this statement's own check and not a stale one.
  set constraints all immediate;
  set constraints all deferred;
  if hard then
    delete from public.circle_members where circle_id = circle and user_id = member;
  else
    update public.circle_members set status = 'removed'
    where circle_id = circle and user_id = member;
  end if;
  set constraints all immediate;
end;
$$;

select throws_ok(
  format(
    $$select pg_temp.remove_member('%s', '%s')$$,
    (select id from t_circle), '00000000-0000-0000-0000-00000000a001'
  ),
  '23503',
  null,
  'the owner cannot simply be removed from their own circle'
);
select throws_ok(
  format(
    $$select pg_temp.remove_member('%s', '%s', true)$$,
    (select id from t_circle), '00000000-0000-0000-0000-00000000a001'
  ),
  '23503',
  null,
  'nor deleted out of it'
);

-- A hand-off is a hand-off: both halves in one transaction, in either order,
-- because the check is deferred to commit.
create or replace function pg_temp.hand_over(circle uuid, from_member uuid, to_member uuid)
returns void
language plpgsql
as $$
begin
  set constraints all immediate;
  set constraints all deferred;
  update public.circles set owner_user_id = to_member where id = circle;
  update public.circle_members set status = 'removed'
  where circle_id = circle and user_id = from_member;
  -- The check is deferred, so the two halves may land in either order.
  set constraints all immediate;
end;
$$;

savepoint before_handover;
select lives_ok(
  format(
    $$select pg_temp.hand_over('%s', '%s', '%s')$$,
    (select id from t_circle),
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-00000000a002'
  ),
  'a hand-off can change the owner and remove the old one in one transaction'
);
rollback to savepoint before_handover;

-- Deleting the circle takes its members with it and protects nothing.
create or replace function pg_temp.drop_circle(circle uuid)
returns void
language plpgsql
as $$
begin
  set constraints all immediate;
  set constraints all deferred;
  delete from public.circles where id = circle;
  set constraints all immediate;
end;
$$;

savepoint before_delete;
select lives_ok(
  format($$select pg_temp.drop_circle('%s')$$, (select id from t_circle)),
  'deleting the circle is not blocked by its own owner invariant'
);
rollback to savepoint before_delete;

-- ---------------------------------------------------------------------------
-- Saving your place updates the auth row; it does not insert one.
-- ---------------------------------------------------------------------------

select is(
  (select is_permanent from public.profiles where user_id = '00000000-0000-0000-0000-00000000a009'),
  false,
  'the guest is still a guest'
);
update auth.users set is_anonymous = false
where id = '00000000-0000-0000-0000-00000000a009';
select is(
  (select is_permanent from public.profiles where user_id = '00000000-0000-0000-0000-00000000a009'),
  true,
  'and linking an identity marks the profile permanent, without a new auth row'
);

-- ---------------------------------------------------------------------------
-- A removed member is a former member everywhere.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where circle_id = (select id from t_circle)
  and user_id = '00000000-0000-0000-0000-00000000a002';

select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
update public.circle_members set muted_all = true
where user_id = '00000000-0000-0000-0000-00000000a002';

-- Read back from outside: a removed member cannot select the row either, so
-- asking them what it says would answer null whatever the update did.
select pg_temp.act_as_postgres();
select is(
  (select muted_all from public.circle_members
   where circle_id = (select id from t_circle)
     and user_id = '00000000-0000-0000-0000-00000000a002'),
  false,
  'a removed member cannot still change their own mute settings'
);

-- ---------------------------------------------------------------------------
-- Functions are not callable by default.
--
-- Postgres grants `execute` on a new function to PUBLIC, which both client
-- roles inherit — so revoking from `anon` and `authenticated` by name removes
-- nothing at all.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('anon', 'public.create_circle(text,text,text,text,text,bytea,uuid)', 'execute'),
  'anon cannot even call create_circle'
);
select ok(
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'and no client role can call the signup trigger by hand'
);

-- The allow-list. Everything else in `public` must be unreachable from a
-- client, and this is the assertion that makes it stay that way: a later
-- migration that forgets `revoke ... from public` fails here by name.
--
-- It has to be a test rather than a default privilege. `alter default
-- privileges ... revoke execute on functions from public` records the revoke
-- and a freshly created function still comes out with `=X` for PUBLIC, so the
-- guarantee cannot live in the schema.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('authenticated', p.oid, 'execute')
     -- `canonical_display_name` is here because a check constraint is evaluated
     -- as the caller: without it a member cannot update their own row at all.
     -- It reads no data.
     -- `replace_response` (S1-09) is the availability write path, and the
     -- only one: a member's answer goes through it or not at all (ADR 0013).
     and p.proname not in (
       'auth_is_member', 'auth_is_owner', 'auth_is_permanent', 'create_circle',
       'canonical_display_name', 'replace_response',
       -- `report_outcome` (S1-10) is the outcome write path.
       'report_outcome',
       -- S1-13. The three identity-continuity calls a client makes: joining by
       -- link, reading the Continue-as list, and moving a guest membership onto
       -- the session in front of it. Each acts on `auth.uid()` and refuses on
       -- its own; `claim_identity` is deliberately *not* here, because the
       -- identity it acts on is an argument rather than the caller.
       'redeem_invite', 'guest_members_for_reattach', 'reattach_member',
       -- S1-15. The plan lifecycle's three. They sit in `public` because
       -- PostgREST exposes nothing else, not because they are public in any
       -- other sense: `issue_invite` is the owner's alone, `reask_audience` the
       -- organiser's, and `create_plan` needs an active member with a saved
       -- place — which it gets from the state machine rather than by asking
       -- itself. Editing, cancelling and reopening add nothing here: they are
       -- `planning.transition_plan`, which no client can call.
       'create_plan', 'issue_invite', 'reask_audience', 'revise_plan', 'cancel_plan',
       -- S1-17. Locking a time in is the organiser's, and the guard that says
       -- so is `transition_plan`'s — this wrapper exists to tell a stale
       -- candidate set apart from a candidate that is not on offer, which the
       -- machine's single boolean cannot. The engine's own functions are not
       -- here: `engine_input` and `store_candidate_set` are the service role's,
       -- because the first is everybody's answers at once and the second is a
       -- write no member makes.
       'confirm_meetup',
       -- And the counting a member may not do for themselves:
       -- `attendance_select_member` shows a retrospective answer only to the
       -- person who gave it, so "was my report corroborated?" has to be asked
       -- of a function that can see the rows and answers without naming
       -- anybody (spec §5.10, §11.1).
       'confirmation_evidence',
       -- S1-21. Two that live in `public` because a caller has to be able to
       -- reach them, and each narrow for its own reason. `preview_for_code`
       -- answers an unauthenticated stranger — a chat app drawing a link card —
       -- with a circle's name, and has no field anything else could be added
       -- to. `founder_summary` answers only a user named in
       -- `private.allowlist`, which is empty until somebody is put in it.
       'preview_for_code', 'founder_summary',
       -- S1-24. The Join page before joining: a circle's name, its inviter's
       -- name and one initial per member, to whoever holds the invite secret —
       -- by its digest, so the secret is never a statement parameter.
       -- (`join_from_plan`, the second way in, is deliberately absent: it is the
       -- service role's, so that nothing reaches it without the Turnstile check
       -- and the rate limits in `join-plan`. `170_join_from_plan.sql`.)
       'invite_preview',
       -- S1-23. Running a circle, both the owner's alone and both refusing
       -- anybody else by name: `live_invite` is the live link's id and digest
       -- (never its secret, which the database does not have), and
       -- `remove_member` the one way somebody is taken out.
       'live_invite', 'remove_member'
     )),
  '',
  'only the intended functions in public are callable by authenticated'
);
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (
       'auth_is_member', 'auth_is_owner', 'auth_is_permanent', 'canonical_display_name',
       -- The two functions in the product that answer somebody with no session
       -- at all. `preview_for_code` is a chat app fetching a link-preview card
       -- (architecture §9.4): a circle's name for a plan short code and null for
       -- everything else, including a code that does not exist — so the
       -- short-code space cannot be walked for circles that do.
       'preview_for_code',
       -- `invite_preview` is the Join page, shown before any prompt (§5.1). It
       -- is keyed by a 256-bit secret's digest, which is not a space anybody
       -- walks, and returns names and initials rather than a roster.
       'invite_preview'
     )),
  '',
  'and anon can call only the read-only helpers'
);

select * from finish();
rollback;
