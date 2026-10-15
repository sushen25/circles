-- SUS-205 / ADR 0070: a member changes the name one circle calls them.
--
-- Allow: a member renames themself in one circle; keeping their own name is not
-- a collision; the roster shows the new name at once. Deny: a duplicate (also
-- in another case or with accents) is refused as duplicate_name; an unusable
-- name is refused; nobody can rename another member (the owner included); a
-- removed member, a stranger and a signed-out caller cannot rename. Contained:
-- the account name and the same person's other circle are untouched, and
-- nothing is written to the outbox or the audit log.

begin;
select plan(18);

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

-- Maya owns Rename Crew. Nina and Tom are in it, Jo was removed. Nina is also
-- in a second circle, Other Crew, where she is called "Nina".
select pg_temp.make_user('00000000-0000-0000-0000-00000000e001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e002', 'Nina Account Name');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e003', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e004', 'Jo');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e005', 'Stranger');

select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select public.create_circle('Rename Crew', 'sky', 'Australia/Melbourne', 'key-rename-crew');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e002');
select public.create_circle('Other Crew', 'clay', 'Australia/Melbourne', 'key-other-crew');

select pg_temp.act_as_postgres();
create temporary table t as
select
  (select id from public.circles where creation_key = 'key-rename-crew') as crew,
  (select id from public.circles where creation_key = 'key-other-crew') as other;
grant select on t to authenticated;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select t.crew, u.id, u.name from t,
  (values ('00000000-0000-0000-0000-00000000e002'::uuid, 'Nina'),
          ('00000000-0000-0000-0000-00000000e003', 'Tom'),
          ('00000000-0000-0000-0000-00000000e004', 'Jo')) as u (id, name);
update public.circle_members set display_name_snapshot = 'Nina'
where circle_id = (select other from t)
  and user_id = '00000000-0000-0000-0000-00000000e002';
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-00000000e004';

create temporary table baseline as
select (select count(*) from jobs.outbox) as events, (select count(*) from private.audit_log) as audits;
grant select on baseline to authenticated;

-- ---------------------------------------------------------------------------
-- A member renames themself.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000e002');
select lives_ok(
  $$ select public.rename_in_circle((select crew from t), '  Nina B ') $$,
  'a member renames themself'
);
select is(
  (select display_name_snapshot from public.circle_members
   where circle_id = (select crew from t) and user_id = '00000000-0000-0000-0000-00000000e002'),
  'Nina B',
  'and the name is stored trimmed'
);
select results_eq(
  $$ select display_name_snapshot from public.circle_roster
     where circle_id = (select crew from t) order by display_name_snapshot $$,
  $$ values ('Maya'::text), ('Nina B'), ('Tom') $$,
  'the roster shows the new name'
);
select lives_ok(
  $$ select public.rename_in_circle((select crew from t), 'Nina B') $$,
  'keeping the name they already have is not a collision'
);

-- ---------------------------------------------------------------------------
-- Only that membership changes.
-- ---------------------------------------------------------------------------
select is(
  (select display_name_snapshot from public.circle_members
   where circle_id = (select other from t) and user_id = '00000000-0000-0000-0000-00000000e002'),
  'Nina',
  'the same person''s other circle is untouched'
);
select is(
  (select display_name from public.profiles where user_id = '00000000-0000-0000-0000-00000000e002'),
  'Nina Account Name',
  'and so is their account name'
);

-- ---------------------------------------------------------------------------
-- A name somebody active already has is refused, however it is written.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.rename_in_circle((select crew from t), 'Tom') $$,
  '23505', 'duplicate_name',
  'a name another active member has is refused as duplicate_name'
);
select throws_ok(
  $$ select public.rename_in_circle((select crew from t), '  tóm ') $$,
  '23505', 'duplicate_name',
  'in another case, or with accents, or with spaces'
);
select is(
  (select display_name_snapshot from public.circle_members
   where circle_id = (select crew from t) and user_id = '00000000-0000-0000-0000-00000000e002'),
  'Nina B',
  'and the refused rename changed nothing'
);
select lives_ok(
  $$ select public.rename_in_circle((select crew from t), 'Jo') $$,
  'a removed member''s name is free to take'
);
select throws_ok(
  $$ select public.rename_in_circle((select crew from t), repeat('a', 41)) $$,
  '23514', 'display_name_unusable',
  'a name over 40 characters is refused as display_name_unusable'
);
select throws_ok(
  $$ select public.rename_in_circle((select crew from t), '   ') $$,
  '23514', 'display_name_unusable',
  'and so is one of only spaces'
);

-- ---------------------------------------------------------------------------
-- Nobody renames another member, and a non-member renames nobody.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select lives_ok(
  $$ select public.rename_in_circle((select crew from t), 'Maya M') $$,
  'the owner renames themself'
);
select results_eq(
  $$ select display_name_snapshot from public.circle_roster
     where circle_id = (select crew from t) order by display_name_snapshot $$,
  $$ values ('Jo'::text), ('Maya M'), ('Tom') $$,
  'and only themself: the others keep the names they chose'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000e004');
select throws_ok(
  $$ select public.rename_in_circle((select crew from t), 'Jo Back') $$,
  'P0002', 'member_not_found',
  'a removed member cannot rename'
);
select pg_temp.act_as('00000000-0000-0000-0000-00000000e005');
select throws_ok(
  $$ select public.rename_in_circle((select crew from t), 'Hello') $$,
  'P0002', 'member_not_found',
  'a stranger cannot rename in a circle they are not in'
);

select pg_temp.act_as_postgres();
select set_config('role', 'anon', true);
select throws_ok(
  $$ select public.rename_in_circle((select crew from t), 'Hello') $$,
  '42501', null,
  'a signed-out caller cannot call it'
);
select set_config('role', 'postgres', true);
select ok(
  (select count(*) from jobs.outbox) = (select events from baseline)
  and (select count(*) from private.audit_log) = (select audits from baseline),
  'no event and no audit row is written: a name is not an analytics fact'
);

select * from finish();
rollback;
