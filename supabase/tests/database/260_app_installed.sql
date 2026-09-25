-- The app tier (S3-01a): `profiles.app_installed_at`, stamped once by
-- `public.mark_app_installed()`, with `growth.app_first_open_linked` emitted
-- by the call that stamped it and by no other.
--
-- Maya has a saved place and opens the app twice (and a third time, as if on
-- a second phone); Priya is a guest; Sam has a saved place and tries to set
-- the column himself.

begin;
select plan(14);

create or replace function pg_temp.make_user(id uuid, name text, permanent boolean default true)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', not permanent,
    jsonb_build_object('is_anonymous', not permanent),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text,
    true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select pg_temp.make_user('26000000-0000-0000-0000-0000000000a1', 'Maya');
select pg_temp.make_user('26000000-0000-0000-0000-0000000000a2', 'Priya', false);
select pg_temp.make_user('26000000-0000-0000-0000-0000000000a3', 'Sam');

-- Allow: the first call stamps it and says so.
select pg_temp.act_as('26000000-0000-0000-0000-0000000000a1');
create temporary table first_call as select * from public.mark_app_installed();
select pg_temp.act_as_postgres();
grant select on first_call to authenticated;

select is((select first_open from first_call), true, 'the first open is the first open');
select isnt((select installed_at from first_call), null, 'and it is stamped');
select is(
  (select app_installed_at from public.profiles where user_id = '26000000-0000-0000-0000-0000000000a1'),
  (select installed_at from first_call),
  'on the caller''s own profile'
);
select is((select count(*)::integer from jobs.outbox where event_name = 'growth.app_first_open_linked' and aggregate_id = '26000000-0000-0000-0000-0000000000a1'), 1, 'and it is announced once');

-- Every later call is a no-op that answers with the first time.
select pg_temp.act_as('26000000-0000-0000-0000-0000000000a1');
select is(
  (select first_open from public.mark_app_installed()), false,
  'a second call is not a first open'
);
select is(
  (select installed_at from public.mark_app_installed()), (select installed_at from first_call),
  'and a third, from another phone, answers with the first time'
);
select pg_temp.act_as_postgres();
select is((select count(*)::integer from jobs.outbox where event_name = 'growth.app_first_open_linked' and aggregate_id = '26000000-0000-0000-0000-0000000000a1'), 1, 'still announced once');

-- A guest has no app tier: nothing changes, and nothing is announced.
select pg_temp.act_as('26000000-0000-0000-0000-0000000000a2', true);
select is(
  (select installed_at from public.mark_app_installed()), null,
  'a guest''s call stamps nothing'
);
select pg_temp.act_as_postgres();
select is(
  (select app_installed_at from public.profiles where user_id = '26000000-0000-0000-0000-0000000000a2'),
  null, 'the guest''s profile is untouched'
);
select is((select count(*)::integer from jobs.outbox where event_name = 'growth.app_first_open_linked' and aggregate_id = '26000000-0000-0000-0000-0000000000a2'), 0, 'and nothing is announced');

-- Deny: the column has one writer. A member cannot set it, or clear it to be
-- counted again.
select pg_temp.act_as('26000000-0000-0000-0000-0000000000a3');
select throws_ok(
  $$ update public.profiles set app_installed_at = now()
     where user_id = '26000000-0000-0000-0000-0000000000a3' $$,
  '42501', null, 'a member cannot stamp the column directly'
);
select throws_ok(
  $$ update public.profiles set app_installed_at = null
     where user_id = '26000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'nor clear it'
);
-- The rest of the profile is still theirs to edit.
select lives_ok(
  $$ update public.profiles set display_name = 'Sammy'
     where user_id = '26000000-0000-0000-0000-0000000000a3' $$,
  'the name is still theirs'
);

-- Deny: nobody without a session can call it.
select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('anon', 'public.mark_app_installed()', 'execute'),
  'anon cannot call it'
);

select * from finish();
rollback;
