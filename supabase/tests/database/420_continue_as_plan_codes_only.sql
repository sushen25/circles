-- Continue-as resolves plan codes only (SUS-180, ADR 0059).
--
-- A removed member keeps what they learned while a member: the circle's id, its
-- short code (every member can read it), the guests' user ids. Asserted as the
-- people involved, with a JWT, because the functions read `auth.uid()`.

begin;
select plan(25);

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

create or replace function pg_temp.digest_of(secret text)
returns bytea
language sql
as $$ select extensions.digest(secret, 'sha256') $$;

-- Maya owns Quiet Crew. Nina and Tom are guests. Rex is a guest who is removed;
-- Rex2 is the fresh anonymous identity he signs in with afterwards.
select pg_temp.make_user('41800000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('41800000-0000-0000-0000-0000000000a1', 'Nina', true);
select pg_temp.make_user('41800000-0000-0000-0000-0000000000a2', 'Tom', true);
select pg_temp.make_user('41800000-0000-0000-0000-0000000000b1', 'Rex', true);
select pg_temp.make_user('41800000-0000-0000-0000-0000000000b2', 'Rex again', true);

select pg_temp.act_as('41800000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id, short_code
from public.create_circle('Quiet Crew', 'sky', 'Australia/Melbourne', 'sus180-quiet');
grant select on fixture to authenticated;

select pg_temp.act_as_postgres();

create or replace function pg_temp.circle_id() returns uuid
language sql security definer as $$ select circle_id from fixture $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '41800000-0000-0000-0000-0000000000a1', 'Nina'),
       (pg_temp.circle_id(), '41800000-0000-0000-0000-0000000000a2', 'Tom'),
       (pg_temp.circle_id(), '41800000-0000-0000-0000-0000000000b1', 'Rex');

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
values (pg_temp.circle_id(), 'named', 'collecting',
        '41800000-0000-0000-0000-000000000001', 'Catch up', 'Australia/Melbourne',
        date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
        timestamptz '2099-09-20T10:00:00Z', 'kvpqrsdt');

create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select id from public.plans where short_code = 'kvpqrsdt' $$;

create or replace function pg_temp.set_state(p_state text) returns void
language plpgsql security definer as $$
begin
  perform set_config('circles.in_transition', 'on', true);
  update public.plans set state = p_state where short_code = 'kvpqrsdt';
  perform set_config('circles.in_transition', 'off', true);
end;
$$;

create or replace function pg_temp.fresh_limits() returns void
language sql security definer as $$ delete from jobs.rate_counters $$;

create or replace function pg_temp.offered(p_code text) returns integer
language sql as $$
  select count(*)::integer from public.guest_members_for_reattach(p_code);
$$;

create or replace function pg_temp.holder(p_name text) returns uuid
language sql security definer as $$
  select m.user_id from public.circle_members m
  where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = p_name;
$$;

-- ---------------------------------------------------------------------------
-- While Rex is a member: he can read the circle's code, as every member can
-- ---------------------------------------------------------------------------
select pg_temp.act_as('41800000-0000-0000-0000-0000000000b1', true);
select is(
  (select short_code from public.circles where id = pg_temp.circle_id()),
  (select short_code from fixture),
  'a member can read the circle''s short code (which is why it cannot be a way back in)'
);
create temporary table noted as select short_code from public.circles where id = pg_temp.circle_id();
grant select on noted to authenticated;

-- The owner removes him and, as the spec has it, resets the link.
select pg_temp.act_as('41800000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.remove_member(pg_temp.circle_id(), '41800000-0000-0000-0000-0000000000b1') $$,
  'the owner removes Rex'
);
select lives_ok(
  $$ select public.issue_invite(pg_temp.circle_id(), extensions.digest('sus180-new-link', 'sha256')) $$,
  'and issues a new invite link'
);

-- ---------------------------------------------------------------------------
-- Rex, on a fresh anonymous identity, with the code he noted
-- ---------------------------------------------------------------------------
select pg_temp.act_as('41800000-0000-0000-0000-0000000000b2', true);

select is(pg_temp.offered((select short_code from noted)), 0, 'the circle''s code lists no guest');
select is(
  (select count(*)::integer from public.preview_for_code('j', (select short_code from noted))),
  0, 'and the link preview treats it as not a link at all (/j/)'
);
select is(
  (select count(*)::integer from public.preview_for_code('p', (select short_code from noted))),
  0, 'and (/p/)'
);

select pg_temp.act_as_postgres();
select pg_temp.set_state('cancelled');
select pg_temp.fresh_limits();
select pg_temp.act_as('41800000-0000-0000-0000-0000000000b2', true);

select is(pg_temp.offered('kvpqrsdt'), 0, 'with the plan over, its code lists nobody either');
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.holder('Nina')) $$,
  'member_not_found',
  'and a caller who kept the circle''s id and a guest''s id takes nobody''s place: no live plan, no way in'
);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.holder('Tom')) $$,
  'member_not_found',
  'whichever guest'
);

select pg_temp.act_as_postgres();
select is(pg_temp.holder('Nina'), '41800000-0000-0000-0000-0000000000a1'::uuid, 'Nina still holds her place');
select is(pg_temp.holder('Tom'), '41800000-0000-0000-0000-0000000000a2'::uuid, 'and Tom his');
select is(
  (select count(*)::integer from private.audit_log
   where action = 'circles.member_reattached' and resource_id = pg_temp.circle_id()),
  0, 'and nothing was recorded as a rejoin'
);

-- ---------------------------------------------------------------------------
-- The rule itself
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from private.circles_open_to_continue_as((select short_code from noted))),
  0, 'asked as the database, a circle''s code resolves to no circle'
);
select is(
  (select count(*)::integer from private.circles_open_to_continue_as('kvpqrsdt')),
  0, 'and a cancelled plan''s code to none'
);
select pg_temp.set_state('collecting');
select is(
  (select array_agg(c) from private.circles_open_to_continue_as('kvpqrsdt') c),
  array[pg_temp.circle_id()],
  'a collecting plan''s code resolves to its circle'
);
select ok(private.plan_live_for_continue_as(pg_temp.plan_id()), 'and the plan is live');
select ok(not private.plan_live_for_continue_as(gen_random_uuid()), 'a plan that does not exist is not');
update public.circles set status = 'archived' where id = pg_temp.circle_id();
select ok(not private.plan_live_for_continue_as(pg_temp.plan_id()), 'nor is one in an archived circle');
update public.circles set status = 'active' where id = pg_temp.circle_id();

-- ---------------------------------------------------------------------------
-- The plan's link still works while the plan is live (SUS-103)
-- ---------------------------------------------------------------------------
select pg_temp.fresh_limits();
select pg_temp.act_as('41800000-0000-0000-0000-0000000000b2', true);
select is(pg_temp.offered('kvpqrsdt'), 2, 'a live plan''s code lists the two guests (Rex is gone from the list)');
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.holder('Nina')) $$,
  'and a person holding it can continue as one of them: the plan link is the product''s way back (accepted residual, ADR 0059)'
);

-- ---------------------------------------------------------------------------
-- The emailed link does not depend on a live plan (it proves an address)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('41800000-0000-0000-0000-0000000000a2', 'tom-quiet@example.com', 'verified', now() - interval '2 days');
select public.issue_reentry_token(
  pg_temp.circle_id(),
  (select id from private.email_contacts where email_normalized = 'tom-quiet@example.com'),
  extensions.digest('tom-quiet-link', 'sha256'));
select pg_temp.set_state('cancelled');
select pg_temp.make_user('41800000-0000-0000-0000-0000000000c1', 'Tom new phone', true);
select pg_temp.act_as('41800000-0000-0000-0000-0000000000c1', true);
select lives_ok(
  $$ select public.reattach_member(null, null, extensions.digest('tom-quiet-link', 'sha256')) $$,
  'Tom comes back with his emailed link even though the plan is cancelled'
);
select pg_temp.act_as_postgres();
select is(pg_temp.holder('Tom'), '41800000-0000-0000-0000-0000000000c1'::uuid, 'and the place is his new identity''s');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'private.plan_live_for_continue_as(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.plan_live_for_continue_as(uuid)', 'execute'),
  'the liveness rule is not an endpoint'
);
select ok(
  not has_function_privilege('authenticated', 'private.circles_open_to_continue_as(text)', 'execute'),
  'nor is the code resolver'
);
select ok(
  has_function_privilege('authenticated', 'public.guest_members_for_reattach(text)', 'execute')
  and has_function_privilege('authenticated', 'public.reattach_member(uuid, uuid, bytea)', 'execute'),
  'and the two public functions are still granted to signed-in callers'
);

select * from finish();
rollback;
