-- Deleting an account, leaving a circle, exporting your data (S4-05, ADR 0083).
--
-- Sunday Crew: Maya owns it and organises its plan; Nina has an account and
-- joined after her; Tom is a guest. Alex has an account and owns Quiet Club,
-- whose only other member, Ren, is a guest: nobody to hand it to.

begin;
select plan(56);

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

select pg_temp.make_user('50000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('50000000-0000-0000-0000-000000000002', 'Nina');
select pg_temp.make_user('50000000-0000-0000-0000-000000000003', 'Tom', true);
select pg_temp.make_user('50000000-0000-0000-0000-000000000004', 'Alex');
select pg_temp.make_user('50000000-0000-0000-0000-000000000005', 'Ren', true);

select pg_temp.act_as('50000000-0000-0000-0000-000000000001');
create temporary table crew as
select id as circle_id from public.create_circle(
  'Sunday Crew', 'sky', 'Australia/Melbourne', 'sus66-crew', 'monthly',
  extensions.digest('crew-secret', 'sha256'), '50000000-0000-0000-0000-0000000000f1'
);
grant select on crew to authenticated;

select pg_temp.act_as('50000000-0000-0000-0000-000000000004');
create temporary table club as
select id as circle_id from public.create_circle(
  'Quiet Club', 'plum', 'Australia/Melbourne', 'sus66-club'
);
grant select on club to authenticated;

select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot, joined_at)
select circle_id, u, n, t from crew, (values
  ('50000000-0000-0000-0000-000000000002'::uuid, 'Nina', now() - interval '2 days'),
  ('50000000-0000-0000-0000-000000000003'::uuid, 'Tom', now() - interval '1 day')
) as m(u, n, t);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '50000000-0000-0000-0000-000000000005', 'Ren' from club;

-- A plan Maya organises, asking all three, and an answer from each.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '50000000-0000-0000-0000-000000000001',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
  timestamptz '2099-09-16T10:00:00Z', 'pnsus66a'
from crew;
create temporary table the_plan as select id from public.plans where short_code = 'pnsus66a';
grant select on the_plan to authenticated;
insert into public.plan_participants (plan_id, revision, user_id)
select (select id from the_plan), 1, m.user_id
from public.circle_members m where m.circle_id = (select circle_id from crew) and m.status = 'active';

create or replace function pg_temp.answer(who uuid, anonymous boolean) returns void language plpgsql as $$
begin
  perform pg_temp.act_as(who, anonymous);
  perform public.replace_response((select id from the_plan), 1, 'windows', jsonb_build_array(
    jsonb_build_object('start', '2099-09-17T08:00:00Z', 'end', '2099-09-17T10:00:00Z')));
end;
$$;
select pg_temp.answer('50000000-0000-0000-0000-000000000001', false);
select pg_temp.answer('50000000-0000-0000-0000-000000000002', false);
select pg_temp.answer('50000000-0000-0000-0000-000000000003', true);

-- Things that point at Maya and are not her membership.
select pg_temp.act_as_postgres();
insert into public.meetup_confirmations (
  plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by
)
select (select id from the_plan), 1, 'c1', timestamptz '2099-09-17T08:00:00Z',
  timestamptz '2099-09-17T10:00:00Z',
  array['50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002']::uuid[],
  '50000000-0000-0000-0000-000000000001';
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('50000000-0000-0000-0000-000000000001', 'maya@example.com', 'verified', now());
insert into private.push_devices (user_id, expo_push_token, platform)
values ('50000000-0000-0000-0000-000000000001', 'ExponentPushToken[maya]', 'ios');
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), '50000000-0000-0000-0000-000000000001', now(), now());
insert into analytics.events (event_name, schema_version, user_id, circle_id, event_id)
values ('plan_created', 1, '50000000-0000-0000-0000-000000000001',
        (select circle_id from crew), gen_random_uuid());
insert into private.audit_log (actor_user_id, action, resource_type, resource_id)
values ('50000000-0000-0000-0000-000000000001', 'circles.member_removed', 'circle',
        (select circle_id from crew));

-- ---------------------------------------------------------------------------
-- What deleting would do, said before it is done.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('50000000-0000-0000-0000-000000000001');
select is(
  (select heir_display_name from public.account_deletion_preview() where circle_name = 'Sunday Crew'),
  'Nina',
  'the preview names the longest-standing permanent member as the heir'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::integer from public.account_deletion_preview() where heir_display_name is null),
  1,
  'and says null when a circle has nobody to go to (it would be archived)'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::integer from public.account_deletion_preview()),
  0,
  'a member who owns nothing is told about nothing'
);

-- ---------------------------------------------------------------------------
-- A guest has leave_circle, not delete_account.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('50000000-0000-0000-0000-000000000003', true);
select throws_ok(
  $$select public.delete_account()$$,
  '42501', 'requires_saved_place',
  'a guest cannot delete an account they have not saved'
);

select ok(
  not has_function_privilege('anon', 'public.delete_account()', 'execute')
  and has_function_privilege('authenticated', 'public.delete_account()', 'execute'),
  'only a signed-in caller can ask'
);

-- ---------------------------------------------------------------------------
-- Maya deletes her account.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('50000000-0000-0000-0000-000000000001');
create temporary table result as select public.delete_account() as r;

select is((select (r ->> 'transferred')::integer from result), 1, 'one circle was handed on');
select is((select (r ->> 'archived')::integer from result), 0, 'and none archived');
select is(
  (select r -> 'stale_plans' from result),
  jsonb_build_array((select id from the_plan)),
  'the plan to recalculate is returned'
);

select pg_temp.act_as_postgres();
select is(
  (select owner_user_id from public.circles where id = (select circle_id from crew)),
  '50000000-0000-0000-0000-000000000002'::uuid,
  'Sunday Crew now belongs to Nina, who has been in it longest'
);
select is(
  (select role from public.circle_members
   where circle_id = (select circle_id from crew) and user_id = '50000000-0000-0000-0000-000000000002'),
  'owner',
  'and she holds the owner role'
);
select is(
  (select status || '/' || display_name_snapshot from public.circle_members
   where circle_id = (select circle_id from crew) and user_id = '50000000-0000-0000-0000-000000000001'),
  'removed/Former member',
  'Maya is removed from it and is a former member to everybody else'
);
select is(
  (select organiser_user_id from public.plans where id = (select id from the_plan)),
  '50000000-0000-0000-0000-000000000002'::uuid,
  'her plan goes to Nina, an eligible participant'
);
select is(
  (select count(*)::integer from public.plan_responses
   where user_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'her answers are deleted'
);
select is(
  (select count(*)::integer from public.plan_responses
   where plan_id = (select id from the_plan)),
  2,
  'and everybody else''s are not'
);
select cmp_ok(
  (select input_version from public.plans where id = (select id from the_plan)), '>', 1,
  'the plan''s candidates are stale until recalculated'
);
select is(
  (select count(*)::integer from private.email_contacts
   where user_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'her email contacts are gone'
);
select is(
  (select enabled from private.push_devices where user_id = '50000000-0000-0000-0000-000000000001'),
  false,
  'her push device is disabled'
);
select is(
  (select count(*)::integer from auth.sessions where user_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'every session is revoked'
);
select ok(
  (select banned_until > now() + interval '10 years'
   from auth.users where id = '50000000-0000-0000-0000-000000000001'),
  'and she cannot sign in again'
);
select is(
  (select count(*)::integer from private.account_deletions
   where user_id = '50000000-0000-0000-0000-000000000001' and purge_after > now() + interval '29 days'),
  1,
  'the purge is due in thirty days'
);
select is(
  (select count(*)::integer from jobs.outbox
   where event_name = 'identity.account_deleted'
     and aggregate_id = '50000000-0000-0000-0000-000000000001'),
  1,
  'identity.account_deleted is emitted once'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000001');
select is(
  public.delete_account() -> 'transferred', '0'::jsonb,
  'asking again finds it done and does nothing more'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::integer from public.circle_roster
   where circle_id = (select circle_id from crew) and display_name_snapshot = 'Maya'),
  0,
  'the roster Nina sees no longer names Maya'
);
select is(
  (select count(*)::integer from public.circles where id = (select circle_id from crew)),
  1,
  'and the circle still works for her'
);

-- ---------------------------------------------------------------------------
-- Alex owns a circle with nobody to hand it to.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('50000000-0000-0000-0000-000000000004');
select lives_ok($$select public.delete_account()$$, 'an owner with nobody to hand the circle to can delete');
select pg_temp.act_as_postgres();
select is(
  (select status from public.circles where id = (select circle_id from club)),
  'archived',
  'the circle is archived, not left owned by nobody who can act'
);

-- ---------------------------------------------------------------------------
-- Leaving a circle.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('50000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.leave_circle((select circle_id from crew))$$,
  '23514', 'owner_cannot_leave',
  'the owner cannot simply leave'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000003', true);
select is(
  public.leave_circle((select circle_id from crew)),
  array[(select id from the_plan)],
  'a guest leaves, and is told which plan needs recalculating'
);
select throws_ok(
  $$select public.leave_circle((select circle_id from crew))$$,
  'P0002', 'member_not_found',
  'leaving twice finds nobody'
);
select pg_temp.act_as_postgres();
select is(
  (select status from public.circle_members
   where circle_id = (select circle_id from crew) and user_id = '50000000-0000-0000-0000-000000000003'),
  'removed',
  'the guest is removed'
);
select is(
  (select count(*)::integer from public.plan_responses
   where user_id = '50000000-0000-0000-0000-000000000003'),
  0,
  'and their answers go, as they do for the owner''s Remove'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.leave_circle((select circle_id from crew))$$,
  'P0002', 'member_not_found',
  'somebody who was never in it is not found'
);

-- ---------------------------------------------------------------------------
-- Export: the caller's own, and nobody else's.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
insert into public.nudge_states (user_id, moment, plan_id)
values ('50000000-0000-0000-0000-000000000002', 'second_response_app', (select id from the_plan));

select pg_temp.act_as('50000000-0000-0000-0000-000000000002');
create temporary table export as select public.export_my_data() as doc;
select pg_temp.act_as_postgres();

select is((select doc #>> '{account,display_name}' from export), 'Nina', 'the export holds her profile');
select is(
  (select jsonb_array_length(doc -> 'availability') from export), 1,
  'and her answer to the plan, with its windows'
);
select is(
  (select jsonb_array_length(doc #> '{availability,0,windows}') from export), 1,
  'windows included'
);
select is((select jsonb_array_length(doc -> 'nudges') from export), 1, 'and her nudge state');
select is(
  (select doc #>> '{circles,0,my_name_there}' from export), 'Nina',
  'and the name she goes by in the circle'
);
select ok(
  (select doc::text !~ '50000000-0000-0000-0000-00000000000[1345]' from export),
  'no other member''s id appears anywhere in it'
);
select ok(
  (select doc::text !~* '(maya|tom|alex|ren|former member)' from export),
  'and no other member''s name'
);
select is(
  (select doc #>> '{account,email_hint}' from export), '5…@example.com',
  'her address is the hint, never whole'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.export_my_data()$$,
  null, 'too_many_requests',
  'a second export the same day is refused'
);

select pg_temp.act_as('50000000-0000-0000-0000-000000000003', true);
select is(
  (select doc #>> '{account,display_name}' from (select public.export_my_data() as doc) e), 'Tom',
  'a guest exports their own data too'
);

-- ---------------------------------------------------------------------------
-- The purge, thirty days on.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
update private.account_deletions set purge_after = now() - interval '1 day';
select jobs.run_retention() as run \gset
select is(:'run'::jsonb -> 'accounts_purged', '2'::jsonb, 'both accounts are purged');
select is(:'run'::jsonb -> 'failed_rules', '[]'::jsonb, 'and no rule failed');
select is(
  (select count(*)::integer from auth.users
   where id in ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004')),
  0,
  'the auth users are gone'
);
select is(
  (select count(*)::integer from public.profiles
   where user_id in ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004')),
  0,
  'and their profiles'
);
select is(
  (select count(*)::integer from public.circles where id = (select circle_id from club)),
  0,
  'the circle Alex archived goes with him'
);
select is(
  (select confirmed_by from public.meetup_confirmations where plan_id = (select id from the_plan)), null,
  'who confirmed a meetup is forgotten; the meetup is not'
);
select is(
  (select available_user_ids from public.meetup_confirmations where plan_id = (select id from the_plan)),
  array['50000000-0000-0000-0000-000000000002']::uuid[],
  'and so is the id in the list of who was free'
);
select is(
  (select created_by from public.circle_invites where circle_id = (select circle_id from crew)), null,
  'who issued an invite is forgotten'
);
select is(
  (select count(*)::integer from analytics.events
   where circle_id = (select circle_id from crew) and event_name = 'plan_created' and user_id is null),
  1,
  'analytics events keep their counts without the user id'
);
select is(
  (select count(*)::integer from private.audit_log
   where actor_user_id = '50000000-0000-0000-0000-000000000001'
      or resource_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'the audit log no longer names her'
);
select is(
  (select count(*)::integer from public.circle_members
   where user_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'no membership of hers remains'
);

-- ---------------------------------------------------------------------------
-- One rule failing does not stop the others.
-- ---------------------------------------------------------------------------

select pg_temp.make_user('50000000-0000-0000-0000-000000000006', 'Sid');
insert into private.account_deletions (user_id, purge_after)
values ('50000000-0000-0000-0000-000000000006', now() - interval '1 day');
insert into jobs.rate_counters (scope, key_hash, window_start, count)
values ('old', extensions.digest('x', 'sha256'), now() - interval '3 days', 1);

create function pg_temp.refuse() returns trigger language plpgsql as $$
begin raise exception 'no'; end; $$;
create trigger refuse_sid before delete on auth.users
  for each row when (old.id = '50000000-0000-0000-0000-000000000006') execute function pg_temp.refuse();

select jobs.run_retention() as run2 \gset
select is(:'run2'::jsonb -> 'failed_rules', '["account_purge"]'::jsonb, 'a purge that raises is named');
select is(
  (select count(*)::integer from jobs.rate_counters where scope = 'old'), 0,
  'and the rules around it still ran'
);
select is(
  (select count(*)::integer from auth.users where id = '50000000-0000-0000-0000-000000000006'), 1,
  'the failed account is kept, to be tried again tomorrow'
);

select * from finish();
rollback;
