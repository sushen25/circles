-- An emailed re-entry link opened by a browser that is already signed in
-- (S1-24, architecture §10).
--
-- "If the browser already holds the right identity, it simply routes to the
-- plan." A guest who saved their place keeps their user id, so the token still
-- names them: that account gets its circle back, with nothing moved and nothing
-- spent. Every other signed-in account is refused exactly as before.
--
-- Sunday Crew: Maya owns it, Priya joined as a guest and has since saved her
-- place, Tom is still a guest, Sam has an account and is nobody's token.

begin;
select plan(7);

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

create or replace function pg_temp.act_as_postgres()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select pg_temp.make_user('16500000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('16500000-0000-0000-0000-000000000002', 'Priya', true);
select pg_temp.make_user('16500000-0000-0000-0000-000000000003', 'Tom', true);
select pg_temp.make_user('16500000-0000-0000-0000-000000000004', 'Sam');

select pg_temp.act_as('16500000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id
from public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'sus40-reentry');
grant select on fixture to authenticated;

select pg_temp.act_as_postgres();

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '16500000-0000-0000-0000-000000000002'::uuid, 'Priya' from fixture
union all
select circle_id, '16500000-0000-0000-0000-000000000003'::uuid, 'Tom' from fixture;

insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values
  ('16500000-0000-0000-0000-000000000002', 'priya@example.com', 'verified', now()),
  ('16500000-0000-0000-0000-000000000003', 'tom@example.com', 'verified', now());

select public.issue_reentry_token(
  (select circle_id from fixture),
  (select id from private.email_contacts where email_normalized = 'priya@example.com'),
  extensions.digest('priya-reentry-link', 'sha256'));
select public.issue_reentry_token(
  (select circle_id from fixture),
  (select id from private.email_contacts where email_normalized = 'tom@example.com'),
  extensions.digest('tom-reentry-link', 'sha256'));

-- Priya saves her place, in place: same id, now permanent.
update auth.users
set is_anonymous = false, raw_app_meta_data = '{"is_anonymous": false}'
where id = '16500000-0000-0000-0000-000000000002';
update public.profiles set is_permanent = true
where user_id = '16500000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- The allow: the account the link was for.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('16500000-0000-0000-0000-000000000002');

select is(
  (select id from public.reattach_member(
    p_reentry_token_hash => extensions.digest('priya-reentry-link', 'sha256'))),
  (select circle_id from fixture),
  'the account the link names gets its circle back'
);

select pg_temp.act_as_postgres();

select is(
  (select user_id from public.circle_members
   where circle_id = (select circle_id from fixture) and display_name_snapshot = 'Priya'),
  '16500000-0000-0000-0000-000000000002'::uuid,
  'and nothing moved'
);

select ok(
  (select used_at is null from private.email_action_tokens
   where token_hash = extensions.digest('priya-reentry-link', 'sha256')),
  'and the link is not spent: it did nothing a link has to be spent for'
);

select is(
  (select count(*)::integer from private.audit_log
   where action = 'circles.member_reattached'
     and metadata ->> 'to_user_id' = '16500000-0000-0000-0000-000000000002'),
  0,
  'and no reattachment is recorded, because none happened'
);

-- ---------------------------------------------------------------------------
-- The denies: every other signed-in account, as before.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('16500000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.reattach_member(
       p_reentry_token_hash => extensions.digest('priya-reentry-link', 'sha256')) $$,
  'caller_is_permanent',
  'somebody else signed in cannot use Priya''s link to reach her circle'
);

select pg_temp.act_as('16500000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.reattach_member(
       p_reentry_token_hash => extensions.digest('tom-reentry-link', 'sha256')) $$,
  'caller_is_permanent',
  'nor can Priya use Tom''s link to take his guest membership'
);

-- Removed since the email went out: the link no longer names a member.
select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from fixture)
  and user_id = '16500000-0000-0000-0000-000000000002';

select pg_temp.act_as('16500000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.reattach_member(
       p_reentry_token_hash => extensions.digest('priya-reentry-link', 'sha256')) $$,
  'caller_is_permanent',
  'a removed member is not handed back the circle they were removed from'
);

select * from finish();
rollback;
