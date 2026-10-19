-- SUS-185: a script cannot skew the founder's decision gates through the
-- analytics ingest.
--
-- Three things live in the database. `analytics_member_ids` tells the ingest
-- which circle and plan ids a caller is an active member of, so the rest are
-- nulled before a row exists; only the service role may ask. `record_events`
-- stores the optional `received_at` the ingest rounds to the hour for the
-- events recorded against nobody, and `now()` otherwise. And a forged event as
-- the ingest now stores it, attributed to no circle and no one, moves neither
-- cohort's reattach or verified gate.

begin;
select plan(21);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', false, '{}'::jsonb,
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;
create or replace function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Maya owns the Real Circle, Nina is in it, then removed; Tom is in no circle.
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0002', 'Nina');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0003', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0004', 'Sam');

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select public.create_circle('Real Circle', 'sky', 'Australia/Melbourne', 'key-d-real');
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
select public.create_circle('Other Circle', 'sky', 'Australia/Melbourne', 'key-d-other');
select pg_temp.act_as_postgres();

create temporary table cs as
select
  (select id from public.circles where creation_key = 'key-d-real') as real,
  (select id from public.circles where creation_key = 'key-d-other') as other;
grant select on cs to public;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select real, '00000000-0000-0000-0000-0000000d0002', 'Nina' from cs;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone, window_start, window_end,
  daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline, short_code
)
select c, 'named', 'collecting', '00000000-0000-0000-0000-0000000d0001', 'Catch up', 'Australia/Melbourne',
  current_date + 2, current_date + 5, 1050, 1350, 120, 2, now() + interval '3 days', sc
from (select real as c, 'kprzzk' as sc from cs union all select other, 'kpvzzk' from cs) v;

create temporary table ps as
select
  (select id from public.plans where short_code = 'kprzzk') as real,
  (select id from public.plans where short_code = 'kpvzzk') as other;
grant select on ps to public;

-- ---------------------------------------------------------------------------
-- analytics_member_ids: who a batch's ids may be kept for.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select is(
  public.analytics_member_ids(
    '00000000-0000-0000-0000-0000000d0001', array[(select real from cs)], array[(select real from ps)]
  ),
  jsonb_build_object('circle_ids', jsonb_build_array((select real from cs)),
                     'plan_ids', jsonb_build_array((select real from ps))),
  'an active member keeps their circle and its plan'
);
select is(
  public.analytics_member_ids(
    '00000000-0000-0000-0000-0000000d0002', array[(select real from cs)], array[(select real from ps)]
  ),
  jsonb_build_object('circle_ids', jsonb_build_array((select real from cs)),
                     'plan_ids', jsonb_build_array((select real from ps))),
  'so does a second member'
);
select is(
  public.analytics_member_ids(
    '00000000-0000-0000-0000-0000000d0003', array[(select real from cs)], array[(select real from ps)]
  ),
  '{"circle_ids": [], "plan_ids": []}'::jsonb,
  'somebody who belongs to nothing keeps neither the circle nor its plan'
);
select is(
  public.analytics_member_ids(
    '00000000-0000-0000-0000-0000000d0001', array[(select other from cs)], array[(select other from ps)]
  ),
  '{"circle_ids": [], "plan_ids": []}'::jsonb,
  'a member of one circle keeps nothing of another, plan included'
);
select is(
  public.analytics_member_ids(
    '00000000-0000-0000-0000-0000000d0001',
    array[(select real from cs), (select other from cs), gen_random_uuid()],
    array[(select other from ps), (select real from ps), gen_random_uuid()]
  ),
  jsonb_build_object('circle_ids', jsonb_build_array((select real from cs)),
                     'plan_ids', jsonb_build_array((select real from ps))),
  'a mixed batch keeps exactly the ones the caller belongs to, and an invented id is not one'
);
select is(
  public.analytics_member_ids(
    '00000000-0000-0000-0000-0000000d0001', array[(select real from cs)], null
  ),
  jsonb_build_object('circle_ids', jsonb_build_array((select real from cs)), 'plan_ids', '[]'::jsonb),
  'a batch with no plans at all is not an error'
);

select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where user_id = '00000000-0000-0000-0000-0000000d0002' and circle_id = (select real from cs);
select pg_temp.act_as_service();
select is(
  public.analytics_member_ids(
    '00000000-0000-0000-0000-0000000d0002', array[(select real from cs)], array[(select real from ps)]
  ),
  '{"circle_ids": [], "plan_ids": []}'::jsonb,
  'a member who has left keeps nothing'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select throws_ok(
  format('select public.analytics_member_ids(%L, array[%L::uuid], null)',
    '00000000-0000-0000-0000-0000000d0001', (select real from cs)),
  '42501', null, 'a signed-in client cannot ask'
);
select pg_temp.act_as_anon();
select throws_ok(
  format('select public.analytics_member_ids(%L, array[%L::uuid], null)',
    '00000000-0000-0000-0000-0000000d0001', (select real from cs)),
  '42501', null, 'nor can an anonymous one'
);

-- ---------------------------------------------------------------------------
-- record_events and received_at.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select public.record_events(jsonb_build_array(
  jsonb_build_object('event_id', '00000000-0000-4000-8000-0000000e0001', 'event_name', 'quiet_ask_created',
    'schema_version', 2, 'properties', '{}'::jsonb, 'occurred_at', '2026-03-01T10:00:00Z',
    'received_at', '2026-03-01T10:00:00Z'),
  jsonb_build_object('event_id', '00000000-0000-4000-8000-0000000e0002', 'event_name', 'circle_join_opened',
    'schema_version', 1, 'properties', '{}'::jsonb, 'occurred_at', '2026-03-01T10:12:34Z')
));
select pg_temp.act_as_postgres();
select is(
  (select received_at from analytics.events where event_id = '00000000-0000-4000-8000-0000000e0001'),
  '2026-03-01T10:00:00Z'::timestamptz, 'a received_at the ingest sends is the one stored'
);
select ok(
  (select received_at > now() - interval '1 minute' and received_at <= now()
   from analytics.events where event_id = '00000000-0000-4000-8000-0000000e0002'),
  'without one the row is stamped now'
);

-- ---------------------------------------------------------------------------
-- A forged event does not move a gate.
--
-- The real events: one reattach by list and one session missing for each of
-- the two cohorts' circles, one email submitted and verified for Maya.
-- ---------------------------------------------------------------------------
insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-0000000d0004');
insert into private.circle_cohorts (circle_id, cohort, source)
select other, 'founder', 'founder' from cs
on conflict (circle_id) do update set cohort = 'founder';

insert into analytics.events (event_id, event_name, schema_version, circle_id, properties, occurred_at)
select gen_random_uuid(), 'session_missing_on_return', 1, c, '{}', now() - interval '1 day'
from cs
cross join lateral (values (cs.real), (cs.other)) v (c);
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata, occurred_at)
select '00000000-0000-0000-0000-0000000d0002', 'circles.member_reattached', 'circle', c,
  jsonb_build_object('from_user_id', gen_random_uuid(), 'to_user_id', '00000000-0000-0000-0000-0000000d0002', 'source', 'list'),
  now() - interval '1 day'
from cs
cross join lateral (values (cs.real), (cs.other)) v (c);
insert into analytics.events (event_id, event_name, schema_version, user_id, circle_id, properties, occurred_at)
select gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000d0001', cs.real,
       '{"save_place": true}'::jsonb, now() - interval '1 day'
from cs;
insert into analytics.events (event_id, event_name, schema_version, user_id, circle_id, properties, occurred_at)
select gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000d0003', cs.real,
       '{"save_place": true}'::jsonb, now() - interval '1 day'
from cs;
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('00000000-0000-0000-0000-0000000d0001', 'maya-forged-test@example.com', 'verified', now() - interval '1 day' + interval '1 minute');

create temporary table gates_before as
select
  (select array[sum(missing), sum(reattached)]::bigint[] from analytics.gate_reattach where cohort = 'external') as ext_reattach,
  (select array[sum(missing), sum(reattached)]::bigint[] from analytics.gate_reattach where cohort = 'founder') as fnd_reattach,
  (select array[sum(submitted), sum(verified)]::bigint[] from analytics.gate_email_verified where cohort = 'external') as ext_verified,
  (select array[sum(submitted), sum(verified)]::bigint[] from analytics.gate_email_verified where cohort = 'founder') as fnd_verified;

-- What a script's batch becomes after the ingest: the caller is nobody (or a
-- member of nothing), so no circle, no plan and no user survive, and a browser
-- id is a hash that belongs to no one.
select public.record_events(jsonb_agg(jsonb_build_object(
  'event_id', gen_random_uuid(), 'event_name', n, 'schema_version', 1,
  'anonymous_id', encode(extensions.digest('forged' || i, 'sha256'), 'hex'), 'properties',
  case n when 'member_reattached' then '{"source": "list"}'::jsonb
         when 'email_submitted' then '{"save_place": true}'::jsonb else '{}'::jsonb end,
  'occurred_at', (now() - interval '1 day' + (i || ' seconds')::interval)::text
)))
from generate_series(1, 40) i,
     unnest(array['member_reattached', 'session_missing_on_return', 'email_submitted', 'email_verified']) n;

select is((select count(*)::int from analytics.events where anonymous_id in (select encode(extensions.digest('forged' || i, 'sha256'), 'hex') from generate_series(1, 40) i)), 160,
  'the forged events are in the table, as the ingest would have stored them');
select is(
  (select array[sum(missing), sum(reattached)]::bigint[] from analytics.gate_reattach where cohort = 'external'),
  (select ext_reattach from gates_before), 'the external reattach gate has not moved'
);
select is(
  (select array[sum(missing), sum(reattached)]::bigint[] from analytics.gate_reattach where cohort = 'founder'),
  (select fnd_reattach from gates_before), 'nor the founder''s'
);
select is(
  (select array[sum(submitted), sum(verified)]::bigint[] from analytics.gate_email_verified where cohort = 'external'),
  (select ext_verified from gates_before), 'the external verified gate has not moved'
);
select is(
  (select array[sum(submitted), sum(verified)]::bigint[] from analytics.gate_email_verified where cohort = 'founder'),
  (select fnd_verified from gates_before), 'nor the founder''s'
);
select is(
  (select count(*)::int from analytics.event_cohort ec join analytics.events e on e.id = ec.event_id
    where e.anonymous_id in (select encode(extensions.digest('forged' || i, 'sha256'), 'hex') from generate_series(1, 40) i) and ec.cohort is not null),
  0, 'an event with no circle, plan or user is counted in no cohort at all'
);

-- And the contrast: forged events that carry a real circle and a real user,
-- which is all a signed-in member could ever send, move neither gate now that
-- neither reads them (SUS-213). Before it, 40 of these raised the reattach gate.
insert into analytics.events (event_id, event_name, schema_version, user_id, circle_id, properties, occurred_at)
select gen_random_uuid(), n, 1, '00000000-0000-0000-0000-0000000d0003', cs.real,
       case n when 'member_reattached' then '{"source": "list"}'::jsonb else '{}'::jsonb end,
       now() - interval '1 day' + interval '2 minutes'
from cs, generate_series(1, 40), unnest(array['member_reattached', 'email_verified', 'account_claimed']) n;
select is(
  (select array[sum(missing), sum(reattached)]::bigint[] from analytics.gate_reattach where cohort = 'external'),
  (select ext_reattach from gates_before), 'forged member_reattached events naming a real circle do not move the reattach gate'
);
select is(
  (select array[sum(submitted), sum(verified)]::bigint[] from analytics.gate_email_verified where cohort = 'external'),
  (select ext_verified from gates_before), 'nor forged email_verified or account_claimed events the verified gate'
);

-- A real reattachment and a real verification do.
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata, occurred_at)
select '00000000-0000-0000-0000-0000000d0002', 'circles.member_reattached', 'circle', cs.real,
  jsonb_build_object('from_user_id', gen_random_uuid(), 'to_user_id', '00000000-0000-0000-0000-0000000d0002', 'source', 'list'),
  now() - interval '1 day'
from cs;
select is(
  (select sum(reattached)::bigint from analytics.gate_reattach where cohort = 'external'),
  (select (ext_reattach)[2] + 1 from gates_before), 'a real reattachment by the list moves the reattach gate'
);
insert into analytics.events (event_id, event_name, schema_version, user_id, circle_id, properties, occurred_at)
select gen_random_uuid(), 'email_submitted', 1, '00000000-0000-0000-0000-0000000d0004', cs.other,
       '{"save_place": true}'::jsonb, now() - interval '2 days'
from cs;
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('00000000-0000-0000-0000-0000000d0004', 'sam-gate-test@example.com', 'verified', now() - interval '1 day');
select is(
  (select array[sum(submitted), sum(verified)]::bigint[] from analytics.gate_email_verified where cohort = 'founder'),
  array[1::bigint, 1::bigint],
  'and a real verification moves the verified gate'
);

select * from finish();
rollback;
