-- SUS-165: `member_profiles.has_saved_place`.
--
-- Circle settings says "Guest" or "Place saved" on every member row. The flag is
-- `profiles.is_permanent`, which no member can read for another except through
-- this view, and the view only returns people the caller shares an *active*
-- circle with. Allow: a co-member reads it. Deny: a non-member and a removed
-- member read nothing, and `profiles` itself still shows a member only their own.

begin;
select plan(10);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous,
    jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'),
    now(), now()
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

-- Maya (saved place, owner), Nina (saved), Sam (guest), Jo (guest, removed
-- later), Zed (guest, in no circle with them).
select pg_temp.make_user('00000000-0000-0000-0000-00000000c001', 'Maya', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000c002', 'Nina', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000c003', 'Sam', true);
select pg_temp.make_user('00000000-0000-0000-0000-00000000c004', 'Jo', true);
select pg_temp.make_user('00000000-0000-0000-0000-00000000c009', 'Zed', true);

select pg_temp.act_as('00000000-0000-0000-0000-00000000c001');
select public.create_circle('Saved Place Crew', 'sky', 'Australia/Melbourne', 'key-saved-place');

select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select c.id, m.id, m.name
from public.circles c,
  (values ('00000000-0000-0000-0000-00000000c002'::uuid, 'Nina'),
          ('00000000-0000-0000-0000-00000000c003', 'Sam'),
          ('00000000-0000-0000-0000-00000000c004', 'Jo')) as m(id, name)
where c.name = 'Saved Place Crew';

-- Allow: a co-member reads the flag, for a saved place and for a guest.
select pg_temp.act_as('00000000-0000-0000-0000-00000000c002');
select is(
  (select has_saved_place from public.member_profiles
   where user_id = '00000000-0000-0000-0000-00000000c001'),
  true,
  'a co-member reads that the owner has a saved place'
);
select is(
  (select has_saved_place from public.member_profiles
   where user_id = '00000000-0000-0000-0000-00000000c003'),
  false,
  'and that a guest has not'
);

-- A guest sees it too: everyone who can open Settings sees every row.
select pg_temp.act_as('00000000-0000-0000-0000-00000000c003', true);
select is(
  (select has_saved_place from public.member_profiles
   where user_id = '00000000-0000-0000-0000-00000000c002'),
  true,
  'a guest reads that another member has a saved place'
);
select is(
  (select has_saved_place from public.member_profiles
   where user_id = '00000000-0000-0000-0000-00000000c003'),
  false,
  'and that their own place is not saved yet'
);

-- The base table still shows a member their own row and nobody else's.
select is(
  (select count(*)::integer from public.profiles),
  1,
  'profiles still shows a member only their own row'
);

-- Deny: somebody who shares no circle reads nothing, and the flag is not a way
-- to probe whether a user id exists.
select pg_temp.act_as('00000000-0000-0000-0000-00000000c009', true);
select is(
  (select count(*)::integer from public.member_profiles),
  0,
  'a non-member reads no row at all, so no flag for anybody'
);

-- The flag flips when the profile becomes permanent (linkIdentity updates the
-- auth row; the trigger does the rest), and a co-member sees it at once.
select pg_temp.act_as_postgres();
update auth.users set is_anonymous = false,
  raw_app_meta_data = jsonb_build_object('is_anonymous', false)
where id = '00000000-0000-0000-0000-00000000c003';
select pg_temp.act_as('00000000-0000-0000-0000-00000000c002');
select is(
  (select has_saved_place from public.member_profiles
   where user_id = '00000000-0000-0000-0000-00000000c003'),
  true,
  'the flag flips the moment a guest saves their place'
);

-- Deny: a removed member reads nothing about the circle they left, and the
-- circle's members no longer see them.
select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-00000000c004';

select pg_temp.act_as('00000000-0000-0000-0000-00000000c004', true);
select is(
  (select count(*)::integer from public.member_profiles
   where user_id <> '00000000-0000-0000-0000-00000000c004'),
  0,
  'a removed member reads no flag for the people they left'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000c002');
select is(
  (select count(*)::integer from public.member_profiles
   where user_id = '00000000-0000-0000-0000-00000000c004'),
  0,
  'and the circle no longer reads the removed member''s'
);

-- The anonymous role cannot read the view at all.
select pg_temp.act_as_postgres();
select ok(
  not has_table_privilege('anon', 'public.member_profiles', 'select'),
  'the anon role cannot select from member_profiles'
);

select * from finish();
rollback;
