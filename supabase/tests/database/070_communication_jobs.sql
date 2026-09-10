-- The tables that never face a client, tested from the outside in.
--
-- Two walks do most of the work: every table in `private`, `jobs` and
-- `analytics` against every client role and privilege, and every function in
-- the non-public schemas against the client roles. A table or function added
-- later with a stray grant fails here by name.

begin;
select plan(32);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous, jsonb_build_object('is_anonymous', anonymous),
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

select pg_temp.make_user('00000000-0000-0000-0000-0000000004a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000004a2', 'Priya');

select pg_temp.act_as('00000000-0000-0000-0000-0000000004a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-jobs');
select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where name = 'Sunday Crew';
grant select on t to anon, authenticated, service_role;
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000004a2', 'Priya' from t;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000004a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-18T10:00:00Z', 'pnjbaa'
from t;
select id as plan_a from public.plans where short_code = 'pnjbaa' \gset

-- ---------------------------------------------------------------------------
-- Nothing in the three schemas is reachable by a client role.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer
   from information_schema.tables tb
   cross join (values ('anon'), ('authenticated')) as r (role_name)
   cross join (values ('select'), ('insert'), ('update'), ('delete')) as p (priv)
   where tb.table_schema in ('private', 'jobs', 'analytics')
     and has_table_privilege(r.role_name, format('%I.%I', tb.table_schema, tb.table_name), p.priv)),
  0,
  'no client role holds any privilege on any table in private, jobs or analytics'
);

select ok(
  (select count(*) from information_schema.tables where table_schema in ('private', 'jobs', 'analytics')) >= 12,
  'and the walk saw the tables this migration created, so a zero above means something'
);

select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by 1), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('private', 'jobs', 'analytics', 'planning')
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))),
  '',
  'no function in the non-public schemas is callable by a client role'
);

select ok(
  not has_function_privilege('authenticated', 'jobs.emit(text, text, uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'jobs.emit(text, text, uuid, jsonb)', 'execute'),
  'jobs.emit is the service role''s and not a member''s'
);

-- ---------------------------------------------------------------------------
-- The outbox.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();
select lives_ok(
  format($$select jobs.emit('circles.invite_rotated', 'circle', '%s', '{"circle_id": "%s"}')$$,
    (select circle_id from t), (select circle_id from t)),
  'the service role emits an event'
);
select is(
  (select count(*)::integer from jobs.outbox where event_name = 'circles.invite_rotated'),
  1,
  'and can read it back'
);
select throws_ok(
  format($$select jobs.emit('circles.invite_rotate', 'circle', '%s')$$, (select circle_id from t)),
  '23514',
  null,
  'an event name outside the §6.3 catalogue is refused, not consumed by nobody'
);
select throws_ok(
  format($$select jobs.emit('circles.invite_rotated', 'circle', '%s', '{"email": "x@example.com"}')$$,
    (select circle_id from t)),
  '23514',
  null,
  'a payload carrying an email is refused at the table'
);
select throws_ok(
  format($$select jobs.emit('circles.invite_rotated', 'circle', '%s', '[]')$$, (select circle_id from t)),
  '23514',
  null,
  'and a payload that is not an object'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000004a1');
select throws_ok(
  format($$select jobs.emit('circles.invite_rotated', 'circle', '%s')$$, (select circle_id from t)),
  '42501',
  null,
  'a member cannot emit'
);
select throws_ok(
  'select count(*) from jobs.outbox',
  '42501',
  null,
  'nor read the outbox'
);

-- ---------------------------------------------------------------------------
-- Notification jobs: the key is the design.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();
select lives_ok(
  format($$insert into jobs.notification_jobs (channel, kind, user_id, plan_id, plan_revision, scheduled_for, idempotency_key)
    values ('push', 'new_plan', '00000000-0000-0000-0000-0000000004a2', '%s', 1, now(), repeat('a', 64))$$, :'plan_a'),
  'a job is scheduled'
);
select throws_ok(
  format($$insert into jobs.notification_jobs (channel, kind, user_id, plan_id, plan_revision, scheduled_for, idempotency_key)
    values ('push', 'new_plan', '00000000-0000-0000-0000-0000000004a2', '%s', 1, now(), repeat('a', 64))$$, :'plan_a'),
  '23505',
  null,
  'the same idempotency key twice is refused — a retry cannot send twice'
);
select throws_ok(
  format($$insert into jobs.notification_jobs (channel, kind, user_id, plan_id, plan_revision, scheduled_for, idempotency_key)
    values ('push', 'new_plan', '00000000-0000-0000-0000-0000000004a2', '%s', 1, now(), 'not-a-sha256')$$, :'plan_a'),
  '23514',
  null,
  'a key that is not 64 hex characters is not the domain''s key'
);
select throws_ok(
  format($$insert into jobs.notification_jobs (channel, kind, user_id, plan_id, plan_revision, scheduled_for, idempotency_key)
    values ('email', 'locked_in', '00000000-0000-0000-0000-0000000004a2', '%s', 1, now(), repeat('b', 64))$$, :'plan_a'),
  '23514',
  null,
  'an email job without a contact is refused'
);
select throws_ok(
  format($$insert into jobs.notification_jobs (channel, kind, user_id, plan_id, plan_revision, scheduled_for, idempotency_key)
    values ('push', 'streak_reminder', '00000000-0000-0000-0000-0000000004a2', '%s', 1, now(), repeat('c', 64))$$, :'plan_a'),
  '23514',
  null,
  'a kind outside packages/domain/communication/kinds.ts is refused'
);

-- ---------------------------------------------------------------------------
-- Email: contacts, subscriptions, tokens, delivery.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into private.email_contacts (user_id, email_normalized, email_hash)
    values ('00000000-0000-0000-0000-0000000004a2', 'priya@example.com', extensions.digest('priya@example.com', 'sha256'))$$,
  'a contact is created pending'
);
select id as contact from private.email_contacts where user_id = '00000000-0000-0000-0000-0000000004a2' \gset
select throws_ok(
  $$insert into private.email_contacts (user_id, email_normalized, email_hash)
    values ('00000000-0000-0000-0000-0000000004a1', 'priya@example.com', extensions.digest('priya@example.com', 'sha256'))$$,
  '23505',
  null,
  'the same address twice is one contact, by hash'
);
select throws_ok(
  $$insert into private.email_contacts (user_id, email_normalized, email_hash)
    values ('00000000-0000-0000-0000-0000000004a1', 'Maya@Example.com ', extensions.digest('x', 'sha256'))$$,
  '23514',
  null,
  'an address that is not normalised is not stored'
);
select throws_ok(
  format($$update private.email_contacts set status = 'suppressed' where id = '%s'$$, :'contact'),
  '23514',
  null,
  'suppressed without a reason and a time is not a state'
);
select lives_ok(
  format($$update private.email_contacts set status = 'suppressed', suppressed_at = now(), suppression_reason = 'bounced' where id = '%s'$$, :'contact'),
  'suppressed with both is'
);

select throws_ok(
  format($$insert into private.email_subscriptions (contact_id, user_id, scope, consent_text_version)
    values ('%s', '00000000-0000-0000-0000-0000000004a2', 'plan_updates', 'v1')$$, :'contact'),
  '23514',
  null,
  'plan_updates without a plan is refused — consent is per plan'
);
select lives_ok(
  format($$insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
    values ('%s', '00000000-0000-0000-0000-0000000004a2', 'plan_updates', '%s', 'v1')$$, :'contact', :'plan_a'),
  'and with one is recorded'
);
select throws_ok(
  format($$insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
    values ('%s', '00000000-0000-0000-0000-0000000004a2', 'plan_updates', '%s', 'v1')$$, :'contact', :'plan_a'),
  '23505',
  null,
  'once per contact per plan'
);

select throws_ok(
  format($$insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
    values ('%s', 'reentry', extensions.digest('t1', 'sha256'), now() + interval '1 day')$$, :'contact'),
  '23514',
  null,
  'a re-entry token without a membership is refused'
);
select lives_ok(
  format($$insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id)
    values ('%s', 'reentry', extensions.digest('t1', 'sha256'), now() + interval '1 day', '%s', '00000000-0000-0000-0000-0000000004a2')$$,
    :'contact', (select circle_id from t)),
  'and with one is issued'
);
select throws_ok(
  format($$insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
    values ('%s', 'verify', extensions.digest('t1', 'sha256'), now() + interval '1 day')$$, :'contact'),
  '23505',
  null,
  'the same token hash twice is refused'
);

select job as job from (select id as job from jobs.notification_jobs limit 1) s \gset
select lives_ok(
  format($$insert into private.email_delivery_events (job_id, provider_message_id, event_type)
    values ('%s', 'msg-1', 'delivered')$$, :'job'),
  'a delivery event is recorded'
);
select throws_ok(
  format($$insert into private.email_delivery_events (job_id, provider_message_id, event_type)
    values ('%s', 'msg-1', 'delivered')$$, :'job'),
  '23505',
  null,
  'and the webhook''s retry of the same event is a no-op, not a second row'
);

-- ---------------------------------------------------------------------------
-- nudge_states: own rows.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000004a2');
select lives_ok(
  format($$insert into public.nudge_states (user_id, moment, plan_id) values ('00000000-0000-0000-0000-0000000004a2', 'confirmed', '%s')$$, :'plan_a'),
  'Priya records a prompt shown to her'
);
select throws_ok(
  format($$insert into public.nudge_states (user_id, moment, plan_id) values ('00000000-0000-0000-0000-0000000004a2', 'confirmed', '%s')$$, :'plan_a'),
  '23505',
  null,
  'at most once per moment per plan'
);
select throws_ok(
  $$insert into public.nudge_states (user_id, moment) values ('00000000-0000-0000-0000-0000000004a1', 'reattached')$$,
  '42501',
  null,
  'and not one shown to Maya'
);

select * from finish();
rollback;
