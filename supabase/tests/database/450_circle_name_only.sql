-- SUS-184 / ADR 0065: co-members see the name a circle knows somebody by, and
-- nothing else of their name.
--
-- Allow: a member reads their own account name; the roster shows the per-circle
-- name; the per-circle name survives an account rename. Deny: a co-member
-- reads the account name through any table or view; a removed member's row, and
-- the time of the removal, is not selectable by anyone in the circle.

begin;
select plan(11);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', false,
    jsonb_build_object('is_anonymous', false),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'),
    now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Maya owns the circle. Each person's account name differs from the name the
-- circle knows them by: Nina's account is "Nina Account Name" and the circle
-- calls her "Nina"; Jo's is "Jo Account Name" and Jo is removed.
select pg_temp.make_user('00000000-0000-0000-0000-00000000f001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f002', 'Nina Account Name');
select pg_temp.make_user('00000000-0000-0000-0000-00000000f004', 'Jo Account Name');

select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select public.create_circle('Name Crew', 'sky', 'Australia/Melbourne', 'key-circle-name-only');

select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id from public.circles where creation_key = 'key-circle-name-only';
grant select on t to authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t,
  (values ('00000000-0000-0000-0000-00000000f002'::uuid, 'Nina'),
          ('00000000-0000-0000-0000-00000000f004', 'Jo')) as u (id, name);

-- Jo is removed.
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-00000000f004';

-- ---------------------------------------------------------------------------
-- A co-member never reads an account name.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select is(
  (select count(*)::integer from public.profiles
   where user_id <> '00000000-0000-0000-0000-00000000f001'),
  0,
  'a co-member cannot read another member''s profile, so not their account name'
);
select is(
  (select display_name from public.profiles
   where user_id = '00000000-0000-0000-0000-00000000f001'),
  'Maya',
  'a member still reads their own account name'
);
select results_eq(
  $$ select display_name_snapshot from public.circle_roster order by display_name_snapshot $$,
  $$ values ('Maya'::text), ('Nina') $$,
  'the roster shows the name the circle knows each person by, not the account name'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'circle_roster'
      and column_name in ('display_name', 'updated_at', 'status', 'removed_at')
  ),
  'and the roster view has no account-name, status or timestamp-of-change column'
);

-- ---------------------------------------------------------------------------
-- A removed member is not listable, and neither is when they were removed.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000f004'),
  0,
  'a removed member''s row is not selectable by the circle'
);
select throws_ok(
  $$ select updated_at from public.circle_members $$,
  '42501',
  null,
  'updated_at, the time of a removal, is not a column a member may select'
);

-- ---------------------------------------------------------------------------
-- A rename leaves the circle's name alone.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000f002');
select lives_ok(
  $$ update public.profiles set display_name = 'Nina Renamed'
     where user_id = '00000000-0000-0000-0000-00000000f002' $$,
  'a member renames their account'
);
select is(
  (select display_name from public.profiles
   where user_id = '00000000-0000-0000-0000-00000000f002'),
  'Nina Renamed',
  'and reads the new account name'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select is(
  (select display_name_snapshot from public.circle_roster
   where user_id = '00000000-0000-0000-0000-00000000f002'),
  'Nina',
  'while the circle still calls them what it did'
);
select pg_temp.act_as_postgres();
select hasnt_function('public', 'sync_member_names', 'nothing overwrites the circle''s names on a rename');
select hasnt_view('public', 'member_profiles', 'and no view carries an account name to a co-member');

select * from finish();
rollback;
