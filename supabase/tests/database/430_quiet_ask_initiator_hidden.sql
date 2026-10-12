-- SUS-181 / ADR 0060: a quiet ask's initiator cannot be inferred from product data.
--
-- Only somebody with a saved place who has not muted quiet asks can start one,
-- so neither a co-member's saved-place state nor their mute flags may be read
-- by another member. Allow: a member reads their own flags and name; the owner
-- reads who has saved a place (spec §5.4, §8.2); the roster view and the plan
-- roster answer the names a screen needs. Deny: a co-member reads another's
-- flags or saved-place state through any table, view or function; a removed
-- row is not selectable; an outsider reads nothing.

begin;
select plan(35);

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
select pg_temp.make_user('00000000-0000-0000-0000-00000000d001', 'Maya', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000d002', 'Nina', false);
select pg_temp.make_user('00000000-0000-0000-0000-00000000d003', 'Sam', true);
select pg_temp.make_user('00000000-0000-0000-0000-00000000d004', 'Jo', true);
select pg_temp.make_user('00000000-0000-0000-0000-00000000d009', 'Zed', true);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');
select public.create_circle('Hidden Crew', 'sky', 'Australia/Melbourne', 'key-initiator-hidden');

select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id from public.circles where creation_key = 'key-initiator-hidden';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t,
  (values ('00000000-0000-0000-0000-00000000d002'::uuid, 'Nina'),
          ('00000000-0000-0000-0000-00000000d003', 'Sam'),
          ('00000000-0000-0000-0000-00000000d004', 'Jo')) as u (id, name);

-- Nina has muted quiet asks; Sam has muted everything. These are the flags that
-- would narrow an initiator, so a co-member must not read them.
update public.circle_members set muted_quiet_asks = true
where user_id = '00000000-0000-0000-0000-00000000d002';
update public.circle_members set muted_all = true
where user_id = '00000000-0000-0000-0000-00000000d003';

-- A plan Nina organises (she is not the owner), asking Maya, Sam and Jo.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-00000000d002',
  'Walk', 'Australia/Melbourne', (now() + interval '6 days')::date, (now() + interval '9 days')::date,
  1050, 1350, 120, 2, now() + interval '2 days', 'hdkrwxma'
from t;
create temporary table tp as
select (select id from public.plans where short_code = 'hdkrwxma') as plan_id;
grant select on tp to anon, authenticated, service_role;
insert into public.plan_participants (plan_id, revision, user_id)
select tp.plan_id, 1, u.id from tp, (values
  ('00000000-0000-0000-0000-00000000d001'::uuid),
  ('00000000-0000-0000-0000-00000000d002'::uuid),
  ('00000000-0000-0000-0000-00000000d003'::uuid)) as u (id);

-- ---------------------------------------------------------------------------
-- circle_members: a member reads their own row and nobody else's.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000d003', true);
select is(
  (select count(*)::integer from public.circle_members
   where user_id <> '00000000-0000-0000-0000-00000000d003'),
  0,
  'a co-member cannot read any other member''s row, so not their muted flags'
);
select is(
  (select muted_quiet_asks from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000d002'),
  null,
  'and a muted quiet-asks flag is not readable for another member'
);
select is(
  (select muted_all from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000d003'),
  true,
  'while a member reads their own flags'
);
select is(
  (select display_name_snapshot from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000d003'),
  'Sam',
  'and their own name'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select is(
  (select muted_quiet_asks from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000d002'),
  true,
  'another member reads their own flag too'
);
select lives_ok(
  $$update public.circle_members set muted_nudges = true
    where user_id = '00000000-0000-0000-0000-00000000d002'$$,
  'and can still change their own switches'
);
select is(
  (select muted_nudges from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000d002'),
  true,
  'and read the change'
);

select pg_temp.act_as_postgres();
select ok(
  not has_table_privilege('authenticated', 'public.circle_members', 'select'),
  'authenticated holds no table-wide select on circle_members'
);
select ok(
  not has_column_privilege('authenticated', 'public.circle_members', 'created_at', 'select')
  and has_column_privilege('authenticated', 'public.circle_members', 'muted_all', 'select'),
  'only the columns of a member''s own row are granted'
);
select ok(
  not has_table_privilege('anon', 'public.circle_members', 'select')
  and not has_table_privilege('anon', 'public.circle_roster', 'select'),
  'and anon reads neither the table nor the roster'
);

-- ---------------------------------------------------------------------------
-- A removed row is not selectable, by the person or by the circle.
-- ---------------------------------------------------------------------------
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-00000000d004';

select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select is(
  (select count(*)::integer from public.circle_members
   where user_id = '00000000-0000-0000-0000-00000000d004'),
  0,
  'a removed member''s row, with their name, is not selectable by the circle'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d004', true);
select is(
  (select count(*)::integer from public.circle_members),
  0,
  'nor by the removed member, who reads nothing of the circle they left'
);
select is(
  (select count(*)::integer from public.circle_roster),
  0,
  'and the roster shows them nobody'
);

-- ---------------------------------------------------------------------------
-- circle_roster: active members, roster columns only.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select columns_are(
  'public', 'circle_roster',
  array['circle_id', 'user_id', 'display_name_snapshot', 'role', 'joined_at'],
  'circle_roster holds roster columns only: no mute flag, no status, no saved place'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select results_eq(
  $$ select display_name_snapshot from public.circle_roster order by display_name_snapshot $$,
  $$ values ('Maya'::text), ('Nina'), ('Sam') $$,
  'a member reads the active roster, and the removed member is not on it'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d009', true);
select is(
  (select count(*)::integer from public.circle_roster),
  0,
  'a non-member reads no roster'
);

-- ---------------------------------------------------------------------------
-- member_profiles: a name and an id, no saved-place state.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select columns_are(
  'public', 'member_profiles', array['user_id', 'display_name'],
  'member_profiles holds a name and an id and says nothing about a saved place'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select is(
  (select count(*)::integer from public.profiles),
  1,
  'profiles still shows a member only their own row'
);

-- ---------------------------------------------------------------------------
-- circle_saved_places: the owner for everyone, a member for themselves.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');
select results_eq(
  format($$ select u.display_name_snapshot, s.has_saved_place
            from public.circle_saved_places(%L) s
            join public.circle_roster u on u.user_id = s.member_user_id
            order by u.display_name_snapshot $$, (select circle_id from t)),
  $$ values ('Maya'::text, true), ('Nina', true), ('Sam', false) $$,
  'the owner reads who has saved a place and who has not, for the active members'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select results_eq(
  format($$ select member_user_id, has_saved_place from public.circle_saved_places(%L) $$,
    (select circle_id from t)),
  $$ values ('00000000-0000-0000-0000-00000000d002'::uuid, true) $$,
  'a member with a saved place reads only their own row'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d003', true);
select results_eq(
  format($$ select member_user_id, has_saved_place from public.circle_saved_places(%L) $$,
    (select circle_id from t)),
  $$ values ('00000000-0000-0000-0000-00000000d003'::uuid, false) $$,
  'a guest reads only their own, and that it is not saved yet'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d004', true);
select is(
  (select count(*)::integer from public.circle_saved_places((select circle_id from t))),
  0,
  'a removed member reads nothing'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d009', true);
select is(
  (select count(*)::integer from public.circle_saved_places((select circle_id from t))),
  0,
  'and neither does somebody who was never in the circle'
);
select is(
  (select count(*)::integer from public.circle_saved_places(gen_random_uuid())),
  0,
  'or one asking about a circle that does not exist'
);

-- The flag follows the account the moment a guest saves their place.
select pg_temp.act_as_postgres();
update auth.users set is_anonymous = false,
  raw_app_meta_data = jsonb_build_object('is_anonymous', false)
where id = '00000000-0000-0000-0000-00000000d003';
select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');
select is(
  (select s.has_saved_place from public.circle_saved_places((select circle_id from t)) s
   where s.member_user_id = '00000000-0000-0000-0000-00000000d003'),
  true,
  'the owner sees it flip when a guest saves their place'
);

-- ---------------------------------------------------------------------------
-- hand_off_candidates: the flag is the owner's; another organiser gets null.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select results_eq(
  format($$ select display_name, has_saved_place from public.hand_off_candidates(%L)
            order by display_name $$, (select plan_id from tp)),
  $$ values ('Maya'::text, null::boolean), ('Sam', null) $$,
  'an organiser who is not the owner is told who could be handed the plan, and nothing about a saved place'
);

select pg_temp.act_as_postgres();
update public.plans set organiser_user_id = '00000000-0000-0000-0000-00000000d001'
where id = (select plan_id from tp);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');
select results_eq(
  format($$ select display_name, has_saved_place from public.hand_off_candidates(%L)
            order by display_name $$, (select plan_id from tp)),
  $$ values ('Nina'::text, true), ('Sam', true) $$,
  'the owner organising it still reads the flag, as SUS-165 promised'
);

-- ---------------------------------------------------------------------------
-- plan_roster: names for the ids a plan mentions.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select results_eq(
  format($$ select display_name, active from public.plan_roster(%L) order by display_name $$,
    (select plan_id from tp)),
  $$ values ('Maya'::text, true), ('Nina', true), ('Sam', true) $$,
  'a member reads the active members of the plan''s circle by name'
);

select pg_temp.act_as_postgres();
insert into public.plan_required_members (plan_id, revision, user_id)
select plan_id, 1, '00000000-0000-0000-0000-00000000d004' from tp;
select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select results_eq(
  format($$ select display_name, active from public.plan_roster(%L)
            where not active $$, (select plan_id from tp)),
  $$ values ('Jo'::text, false) $$,
  'a removed member is named when the plan still requires them, so the organiser can take them off'
);
select is(
  (select count(*)::integer from public.plan_roster((select plan_id from tp))),
  4,
  'and nobody else who left is'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d009', true);
select is(
  (select count(*)::integer from public.plan_roster((select plan_id from tp))),
  0,
  'a non-member reads no names for the plan'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d004', true);
select is(
  (select count(*)::integer from public.plan_roster((select plan_id from tp))),
  0,
  'and neither does a removed member'
);
select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('anon', 'public.plan_roster(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.circle_saved_places(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.plan_roster(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.circle_saved_places(uuid)', 'execute'),
  'both functions are for signed-in members only'
);

-- Nothing a client may call, read or select answers "who could start a quiet
-- ask" for a co-member: the columns that would are gone.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('member_profiles', 'circle_roster')
      and column_name in ('has_saved_place', 'is_permanent', 'muted_quiet_asks', 'muted_all', 'muted_nudges')
  ),
  'neither the profile view nor the roster view carries a saved-place or mute column'
);
select ok(
  not exists (
    select 1
    from information_schema.role_column_grants g
    where g.table_schema = 'public' and g.table_name = 'profiles'
      and g.grantee in ('anon') and g.privilege_type = 'SELECT'
  ),
  'and anon reads no profile column'
);

select * from finish();
rollback;
