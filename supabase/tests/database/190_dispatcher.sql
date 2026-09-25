-- The dispatcher's half of the database (S1-20).
--
-- `process-scheduled-jobs` is a loop in Deno over the twelve functions below,
-- and every promise it makes that a test can hold it to is made here: that two
-- runs cannot overlap, that an event is drained once, that a job is written
-- once however often it is computed, that one address gets one copy, that a
-- cancelled evening takes its reminders with it, and that a plan whose window
-- has gone expires without anybody doing anything.
--
-- The stack's seed has already filled the outbox and made four circles, so
-- nothing here asserts a total. Each assertion is about the rows this file
-- made — which is also how the dispatcher itself has to think.

begin;
select plan(66);

create or replace function pg_temp.make_user(
  id uuid, name text, permanent boolean default false, confirmed boolean default false
)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', case when confirmed then now() end, not permanent,
    jsonb_build_object('is_anonymous', not permanent),
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

create or replace function pg_temp.contact_of(addr text, who uuid) returns uuid
language sql security definer as $$
  select c.id from private.email_contacts c
  where c.email_normalized = addr and c.user_id = who
$$;

create or replace function pg_temp.status_of(contact uuid) returns text
language sql security definer as $$
  select c.status from private.email_contacts c where c.id = contact
$$;

create or replace function pg_temp.job_status(key text) returns text
language sql security definer as $$
  select j.status from jobs.notification_jobs j where j.idempotency_key = key
$$;

-- Maya organises and has confirmed her address by signing in. Priya reads
-- email at one address and holds two identities at it — a laptop and a phone
-- that lost its session, which is the commonest real thing that happens
-- (spec §9). Tom is in the circle and has asked for nothing.
select pg_temp.make_user('00000000-0000-0000-0000-0000000019a1', 'Maya', true, true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000019a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000019a3', 'Priya 2');
select pg_temp.make_user('00000000-0000-0000-0000-0000000019a4', 'Tom', true, false);

select pg_temp.act_as('00000000-0000-0000-0000-0000000019a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-dispatch');

select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id from public.circles where creation_key = 'key-dispatch';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t,
  (values ('00000000-0000-0000-0000-0000000019a2'::uuid, 'Priya'),
          ('00000000-0000-0000-0000-0000000019a3'::uuid, 'Priya 2'),
          ('00000000-0000-0000-0000-0000000019a4'::uuid, 'Tom')) as u (id, name);

-- A live plan, and one whose fortnight is over.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000019a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'dsphva'
from t;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'ready', '00000000-0000-0000-0000-0000000019a1',
  'Last fortnight', 'Australia/Melbourne', date '2020-09-17', date '2020-09-20',
  1050, 1350, 120, 2, timestamptz '2020-09-20T10:00:00Z', 'dsphvb'
from t;

create temporary table tp as
select (select id from public.plans where short_code = 'dsphva') as live_plan,
       (select id from public.plans where short_code = 'dsphvb') as old_plan;
grant select on tp to anon, authenticated, service_role;
create or replace function pg_temp.live_plan() returns uuid
language sql security definer as $$ select live_plan from tp $$;
create or replace function pg_temp.old_plan() returns uuid
language sql security definer as $$ select old_plan from tp $$;

insert into public.plan_participants (plan_id, revision, user_id)
select pg_temp.live_plan(), 1, u.id from (values
  ('00000000-0000-0000-0000-0000000019a1'::uuid),
  ('00000000-0000-0000-0000-0000000019a2'::uuid),
  ('00000000-0000-0000-0000-0000000019a3'::uuid),
  ('00000000-0000-0000-0000-0000000019a4'::uuid)) as u (id);

-- One address, two identities, both subscribed to the same plan. This is the
-- fixture the "one copy per event" rule exists for.
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('00000000-0000-0000-0000-0000000019a2', 'priya@example.com', 'verified', now()),
       ('00000000-0000-0000-0000-0000000019a3', 'priya@example.com', 'verified', now());

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, status, consent_text_version)
select c.id, c.user_id, 'plan_updates', pg_temp.live_plan(), 'active', '2026-09-14'
from private.email_contacts c where c.email_normalized = 'priya@example.com';

-- ---------------------------------------------------------------------------
-- Who may call any of it
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.dispatch_begin(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_claim_events(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_claim_due(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_context(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_enqueue(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_organiser_contact(uuid)', 'execute'),
  'a signed-in member reaches none of the dispatcher: these read every address in the system'
);
select ok(
  not has_function_privilege('anon', 'public.dispatch_health(boolean)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_timed_work(integer)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_job_result(uuid, text, text, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_cancel_pending(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_event_result(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_end(text)', 'execute'),
  'and nor does an anonymous caller, including the two that only expire and count'
);

-- ---------------------------------------------------------------------------
-- The lease: two invocations a minute apart cannot overlap
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select ok(public.dispatch_begin('run-one'), 'the first run takes the lease');
select ok(not public.dispatch_begin('run-two'), 'the second is refused while the first holds it');
select ok(not public.dispatch_end('run-two'),
  'and cannot release a lease it never held — a late finisher must not free the current holder''s');
select ok(public.dispatch_end('run-one'), 'the holder releases it');
select ok(public.dispatch_begin('run-two'), 'and the next run takes it');
select ok(public.dispatch_end('run-two'), 'released again, so nothing here leaves the lease held');

-- ---------------------------------------------------------------------------
-- Draining the outbox
-- ---------------------------------------------------------------------------
create temporary table te as
select jobs.emit('circles.member_joined', 'circle', (select circle_id from t),
  jsonb_build_object('circle_id', (select circle_id from t),
    'user_id', '00000000-0000-0000-0000-0000000019a4'::uuid, 'role', 'member')) as event_id;
grant select on te to anon, authenticated, service_role;
create or replace function pg_temp.event_id() returns uuid
language sql security definer as $$ select event_id from te $$;

select ok(
  (select public.dispatch_claim_events(500)) @> jsonb_build_array(jsonb_build_object('id', pg_temp.event_id())),
  'an unprocessed event is claimed'
);

select lives_ok(
  format($$ select public.dispatch_event_result(%L) $$, pg_temp.event_id()),
  'and can be marked handled'
);

select ok(
  not ((select public.dispatch_claim_events(500)) @> jsonb_build_array(jsonb_build_object('id', pg_temp.event_id()))),
  'after which it is never claimed again'
);

select pg_temp.act_as_postgres();
create temporary table tf as
select jobs.emit('circles.member_removed', 'circle', (select circle_id from t),
  jsonb_build_object('circle_id', (select circle_id from t),
    'user_id', '00000000-0000-0000-0000-0000000019a4'::uuid)) as event_id;
grant select on tf to anon, authenticated, service_role;
create or replace function pg_temp.failing_event() returns uuid
language sql security definer as $$ select event_id from tf $$;

select pg_temp.act_as_service();
select public.dispatch_event_result(pg_temp.failing_event(), 'db:23505');

select pg_temp.act_as_postgres();
select is(
  (select attempts::text || '/' || coalesce(processed_at::text, 'unprocessed')
   from jobs.outbox where id = pg_temp.failing_event()),
  '1/unprocessed',
  'a failure counts an attempt and leaves the event for the next tick'
);

select pg_temp.act_as_service();
select public.dispatch_event_result(pg_temp.failing_event(), 'db:23505');
select public.dispatch_event_result(pg_temp.failing_event(), 'db:23505');
select public.dispatch_event_result(pg_temp.failing_event(), 'db:23505');
select public.dispatch_event_result(pg_temp.failing_event(), 'db:23505');

select pg_temp.act_as_postgres();
select ok(
  (select processed_at is not null and last_error = 'db:23505'
   from jobs.outbox where id = pg_temp.failing_event()),
  'and at five it is given up on, with the code still on the row saying why'
);

select throws_ok(
  format($$ update jobs.outbox set last_error = 'Invalid to field: priya@example.com' where id = %L $$,
    pg_temp.failing_event()),
  '23514'::text,
  null::text,
  'an exception''s text cannot be written there: last_error is a code, and that is where addresses turn up'
);

-- ---------------------------------------------------------------------------
-- The context the rules are asked about
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select is(
  jsonb_array_length(public.dispatch_context(pg_temp.live_plan()) -> 'members'),
  4,
  'the context carries the whole roster, because muting and removal are its rules'
);
select is(
  jsonb_array_length(public.dispatch_context(pg_temp.live_plan()) -> 'participant_ids'),
  4,
  'and who the plan was addressed to, which is not the same list'
);
select is(
  jsonb_array_length(public.dispatch_context(pg_temp.live_plan()) -> 'email_recipients'),
  2,
  'both of Priya''s identities may be emailed about this plan: two contacts, one address'
);
select is(
  public.dispatch_context('00000000-0000-0000-0000-00000000dead'),
  null,
  'a plan that is not there has no context, rather than an empty one'
);

-- ---------------------------------------------------------------------------
-- The organiser's address becomes something that can be written to
-- ---------------------------------------------------------------------------
select is(
  public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000019a2'),
  null,
  'a guest has no confirmed address of ours, so there is nothing to write to'
);
select is(
  public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000019a4'),
  null,
  'nor has a saved place that has never confirmed one'
);
select isnt(
  public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000019a1'),
  null,
  'the organiser''s confirmed auth address becomes a contact'
);
select is(
  pg_temp.status_of(public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000019a1')),
  'verified',
  'verified, because auth already proved she controls it — the same proof a link gives'
);
select is(
  public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000019a1'),
  pg_temp.contact_of('00000000-0000-0000-0000-0000000019a1@example.com',
    '00000000-0000-0000-0000-0000000019a1'),
  'and asking twice gives the same row, never a second contact for one address'
);

select pg_temp.act_as_postgres();
update private.email_contacts
set status = 'suppressed', suppressed_at = now(), suppression_reason = 'bounced', verified_at = null
where user_id = '00000000-0000-0000-0000-0000000019a1';

select pg_temp.act_as_service();
select is(
  public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000019a1'),
  null,
  'a bounce stops organiser email exactly as it stops plan-update email'
);

-- ---------------------------------------------------------------------------
-- Writing jobs, once
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
create temporary table tk as
select encode(extensions.digest('locked-in-priya-one', 'sha256'), 'hex') as key_one,
       encode(extensions.digest('locked-in-priya-two', 'sha256'), 'hex') as key_two,
       encode(extensions.digest('reminder-priya-one', 'sha256'), 'hex') as key_reminder,
       (select c.id from private.email_contacts c
        where c.email_normalized = 'priya@example.com'
          and c.user_id = '00000000-0000-0000-0000-0000000019a2') as contact_one,
       (select c.id from private.email_contacts c
        where c.email_normalized = 'priya@example.com'
          and c.user_id = '00000000-0000-0000-0000-0000000019a3') as contact_two;
grant select on tk to anon, authenticated, service_role;

select pg_temp.act_as_service();
select is(
  public.dispatch_enqueue((
    select jsonb_build_array(
      jsonb_build_object('channel', 'email', 'kind', 'locked_in', 'contact_id', contact_one,
        'plan_id', pg_temp.live_plan(), 'plan_revision', 1,
        'scheduled_for', now() - interval '1 minute', 'idempotency_key', key_one),
      jsonb_build_object('channel', 'email', 'kind', 'locked_in', 'contact_id', contact_two,
        'plan_id', pg_temp.live_plan(), 'plan_revision', 1,
        'scheduled_for', now() - interval '1 minute', 'idempotency_key', key_two),
      jsonb_build_object('channel', 'email', 'kind', 'reminder', 'contact_id', contact_one,
        'plan_id', pg_temp.live_plan(), 'plan_revision', 1,
        'scheduled_for', now() + interval '2 days', 'idempotency_key', key_reminder))
    from tk)),
  3,
  'three jobs are written'
);

select is(
  public.dispatch_enqueue((
    select jsonb_build_array(
      jsonb_build_object('channel', 'email', 'kind', 'locked_in', 'contact_id', contact_one,
        'plan_id', pg_temp.live_plan(), 'plan_revision', 1,
        'scheduled_for', now(), 'idempotency_key', key_one))
    from tk)),
  0,
  'and computing the same message again writes nothing: the key is the whole of the promise'
);

-- ---------------------------------------------------------------------------
-- What is due, and the second copy to one address
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text),
  2,
  'the two locked-in jobs are due; the reminder two days out is not'
);

select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text and (j ->> 'superseded')::boolean),
  0,
  'neither of the two is superseded yet, because neither letter has gone'
);

-- The correction round 3 found. The flag used to mean "an earlier job for this
-- address is still scheduled", so when the earlier one turned out to be
-- ineligible — its owner had left the circle — the first was skipped for that
-- and the second was skipped as a duplicate of a letter that was never sent.
-- The mailbox got nothing at all.
select pg_temp.act_as_postgres();
update public.circle_members m set status = 'removed'
where m.user_id = (
  select c.user_id from private.email_contacts c
  join jobs.notification_jobs j on j.contact_id = c.id
  where c.email_normalized = 'priya@example.com' and j.kind = 'locked_in'
  order by j.scheduled_for, j.created_at, j.id limit 1);

select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text and (j ->> 'superseded')::boolean),
  0,
  'and an ineligible sibling supersedes nobody: the eligible copy is still claimable'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text
     and (j ->> 'subscribed')::boolean and (j ->> 'member_active')::boolean),
  1,
  'exactly one of the two is still owed the letter'
);

select pg_temp.act_as_postgres();
update public.circle_members m set status = 'active'
where m.circle_id = (select circle_id from t);

-- A cadence nudge has no plan, so the claim cannot find its circle through
-- one: it is found through the job's own `circle_id` (S2-04). Before 0025 its
-- `circle_archived` was always false. Scheduled long ago so that it is among
-- the first the claim takes.
insert into jobs.notification_jobs (
  channel, kind, contact_id, circle_id, scheduled_for, idempotency_key
)
select 'email', 'about_time',
  pg_temp.contact_of('00000000-0000-0000-0000-0000000019a1@example.com',
    '00000000-0000-0000-0000-0000000019a1'),
  circle_id, timestamptz '2000-01-01T00:00:00Z', repeat('c', 64)
from t;

-- Archiving stops all prompts (spec §5.2), including the ones already queued:
-- the claim says so at the moment of sending (S1-23), and bringing the circle
-- back lets them go again.
update public.circles set status = 'archived' where id = (select circle_id from t);
select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text and (j ->> 'circle_archived')::boolean),
  2,
  'a job queued before its circle was archived is claimed as archived'
);
select pg_temp.act_as_postgres();
update public.circles set status = 'active' where id = (select circle_id from t);
select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text and (j ->> 'circle_archived')::boolean),
  0,
  'and brought back, it is not'
);
select pg_temp.act_as_postgres();
update public.circles set status = 'archived' where id = (select circle_id from t);
select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'kind' = 'about_time' and j ->> 'circle_id' = (select circle_id::text from t)
     and (j ->> 'circle_archived')::boolean),
  1,
  'a cadence nudge, which has no plan, is claimed as archived through its own circle'
);
select pg_temp.act_as_postgres();
update public.circles set status = 'active' where id = (select circle_id from t);
select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'kind' = 'about_time' and j ->> 'circle_id' = (select circle_id::text from t)
     and not (j ->> 'circle_archived')::boolean),
  1,
  'and brought back, it is not'
);
select pg_temp.act_as_postgres();
delete from jobs.notification_jobs where idempotency_key = repeat('c', 64);

-- A copy that really has gone does supersede the other.
update jobs.notification_jobs j
set status = 'sent', sent_at = now(), provider_message_id = 'already-gone'
where j.id = (
  select j2.id from jobs.notification_jobs j2
  join private.email_contacts c on c.id = j2.contact_id
  where c.email_normalized = 'priya@example.com' and j2.kind = 'locked_in'
  order by j2.scheduled_for, j2.created_at, j2.id limit 1);

select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text and (j ->> 'superseded')::boolean),
  1,
  'one address, one copy: the second is superseded once the first has actually been sent'
);

select pg_temp.act_as_postgres();
update jobs.notification_jobs j
set status = 'scheduled', sent_at = null, provider_message_id = null
where j.provider_message_id = 'already-gone';
select pg_temp.act_as_service();

select is(
  (select distinct j ->> 'email' from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text),
  'priya@example.com',
  'the address is read here, once, by the only thing that needs it'
);

select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text and (j ->> 'subscribed')::boolean),
  2,
  'and the consent is read here too, because it can be withdrawn after the job is written'
);

-- "Stop emails for this meetup", on a job that was written days ago.
select pg_temp.act_as_postgres();
update private.email_subscriptions s
set status = 'withdrawn', withdrawn_at = now()
where s.plan_id = pg_temp.live_plan();

select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text and (j ->> 'subscribed')::boolean),
  0,
  'a withdrawn subscription stops a letter that was already queued — otherwise the link stops nothing'
);

select pg_temp.act_as_postgres();
update private.email_subscriptions s
set status = 'active', withdrawn_at = null
where s.plan_id = pg_temp.live_plan();

-- Somebody removed from the circle also drops out of `email_recipients_for`,
-- and they withdrew nothing. The two have to be tellable apart, or the reason
-- on the row is a wrong story (review round 2).
update public.circle_members m set status = 'removed'
where m.user_id = '00000000-0000-0000-0000-0000000019a3';

select pg_temp.act_as_service();
select is(
  (select count(*)::integer from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'plan_id' = pg_temp.live_plan()::text
     and not (j ->> 'subscribed')::boolean and not (j ->> 'member_active')::boolean),
  1,
  'a removed member''s queued letter says so, rather than saying they unsubscribed'
);

select pg_temp.act_as_postgres();
update public.circle_members m set status = 'active'
where m.user_id = '00000000-0000-0000-0000-0000000019a3';
select pg_temp.act_as_service();

-- ---------------------------------------------------------------------------
-- Recording what happened to a send
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
create temporary table tj as
select (select id from jobs.notification_jobs where idempotency_key = (select key_one from tk)) as job_one,
       (select id from jobs.notification_jobs where idempotency_key = (select key_two from tk)) as job_two,
       (select id from jobs.notification_jobs where idempotency_key = (select key_reminder from tk)) as job_reminder;
grant select on tj to anon, authenticated, service_role;

select pg_temp.act_as_service();
select public.dispatch_job_result((select job_one from tj), 'sent', null, 'resend-message-id');
select pg_temp.act_as_postgres();
select ok(
  (select status = 'sent' and sent_at is not null and provider_message_id = 'resend-message-id'
     and last_error is null and attempt_count = 1
   from jobs.notification_jobs where id = (select job_one from tj)),
  'a send is recorded with the provider id the delivery webhook will look it up by'
);

select pg_temp.act_as_service();
select public.dispatch_job_result((select job_two from tj), 'retry', 'email_unavailable', null,
  now() + interval '5 minutes');
select pg_temp.act_as_postgres();
select ok(
  (select status = 'scheduled' and scheduled_for > now() + interval '4 minutes'
     and last_error = 'email_unavailable' and sent_at is null
   from jobs.notification_jobs where id = (select job_two from tj)),
  'a transient failure stays scheduled, further out, with the reason as a code'
);

select pg_temp.act_as_service();
select public.dispatch_job_result((select job_two from tj), 'failed', 'email_rejected');
select pg_temp.act_as_postgres();
select is(
  (select status from jobs.notification_jobs where id = (select job_two from tj)),
  'failed',
  'and one the provider will keep refusing is given up on'
);

select throws_ok(
  format($$ update jobs.notification_jobs set last_error = 'bounced: priya@example.com' where id = %L $$,
    (select job_two from tj)),
  '23514'::text,
  null::text,
  'a job''s last_error is a code too, for the same reason'
);

-- ---------------------------------------------------------------------------
-- The evening is off, so the letters about it stop
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(
  public.dispatch_cancel_pending(pg_temp.live_plan(), 1),
  1,
  'cancelling takes back the reminder that was waiting two days out'
);
select is(
  public.dispatch_cancel_pending(pg_temp.live_plan(), 1),
  0,
  'and takes back nothing the second time: a sent letter cannot be unsent'
);
select pg_temp.act_as_postgres();
select is(
  (select status || '/' || last_error from jobs.notification_jobs where id = (select job_reminder from tj)),
  'skipped/superseded',
  'as skipped rather than failed: nothing went wrong'
);
select is(
  (select status from jobs.notification_jobs where id = (select job_one from tj)),
  'sent',
  'and the announcement that already went is left exactly as it was'
);

-- ---------------------------------------------------------------------------
-- The work a clock creates
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select public.dispatch_timed_work(100);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.old_plan()),
  1,
  'a deadline that has passed is announced once, into the outbox the drain reads'
);
select is(
  (select state from public.plans where id = pg_temp.old_plan()),
  'expired',
  'and a plan whose last possible start has gone expires, with nobody as the actor'
);

select pg_temp.act_as_service();
select public.dispatch_timed_work(100);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.old_plan()),
  1,
  'running again announces nothing further: the outbox row is the marker'
);
select is(
  (select state from public.plans where id = pg_temp.live_plan()),
  'collecting',
  'and a plan whose fortnight is still ahead is left alone'
);

-- "Give it one more day" (spec §5.7). The deadline moves out, passes again,
-- and the organiser has to hear about the second one too.
select pg_temp.act_as_postgres();
update public.plans set state = 'collecting', response_deadline = now() - interval '2 hours'
where id = pg_temp.live_plan();

select pg_temp.act_as_service();
select public.dispatch_timed_work(100);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.live_plan()),
  1,
  'a deadline that has passed is announced'
);

update public.plans set response_deadline = now() - interval '1 hour' where id = pg_temp.live_plan();
select pg_temp.act_as_service();
select public.dispatch_timed_work(100);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.live_plan()),
  2,
  'and an extended deadline that passes again is announced again: the marker is the deadline, not the plan'
);

-- The half of "once per deadline" that round 1 did not measure. Every deadline
-- this product makes is fractional — `defaultDeadline` is `now + 1h` — and a
-- marker rendered without its microseconds never matches the row it was
-- written from, so the sweep announced the same deadline on every tick for as
-- long as the plan stayed open (review round 2).
select ok(
  (select date_trunc('second', p.response_deadline) <> p.response_deadline
   from public.plans p where p.id = pg_temp.live_plan()),
  'the deadline under test has a fraction, which is the ordinary case'
);

select pg_temp.act_as_service();
select public.dispatch_timed_work(100);
select public.dispatch_timed_work(100);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.live_plan()),
  2,
  'and running again against the same deadline announces nothing further, to the microsecond'
);
select ok(
  exists (
    select 1 from jobs.outbox o join public.plans p on p.id = o.aggregate_id
    where o.event_name = 'planning.deadline_passed' and p.id = pg_temp.live_plan()
      and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
  ),
  'because the marker it wrote is the instant it read, to the microsecond, not a rounding of it'
);

-- ---------------------------------------------------------------------------
-- Retention does not delete the address the organiser is written to
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

-- Maya's contact as it is a month after she first organised something: her own
-- auth address, verified, with no subscription — because an organiser kind is
-- not a subscription. The old rule took it, and the cascade took the "did it
-- happen?" letter due at nine the next morning with it.
update private.email_contacts c
set status = 'verified', verified_at = now() - interval '31 days',
    suppressed_at = null, suppression_reason = null
where c.user_id = '00000000-0000-0000-0000-0000000019a1';

-- And a contact that is nobody's auth address, with nothing subscribed, that
-- has a letter still waiting. It is a month old and would otherwise go.
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('00000000-0000-0000-0000-0000000019a4', 'tom-elsewhere@example.com', 'verified',
  now() - interval '31 days');

insert into jobs.notification_jobs (
  channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
)
select 'email', 'did_it_happen_participant', c.id, pg_temp.live_plan(), 1,
  now() + interval '3 days',
  encode(extensions.digest('waiting-on-tom', 'sha256'), 'hex')
from private.email_contacts c where c.email_normalized = 'tom-elsewhere@example.com';

select jobs.run_retention();

select is(
  (select count(*)::integer from private.email_contacts c
   where c.user_id = '00000000-0000-0000-0000-0000000019a1'
     and c.email_normalized = '00000000-0000-0000-0000-0000000019a1@example.com'),
  1,
  'the organiser''s own auth address is not a plan''s contact, and retention leaves it alone'
);
select is(
  (select count(*)::integer from private.email_contacts c
   where c.email_normalized = 'tom-elsewhere@example.com'),
  1,
  'and no contact with a letter still waiting is deleted from under it'
);
select is(
  (select count(*)::integer from jobs.notification_jobs j
   where j.idempotency_key = encode(extensions.digest('waiting-on-tom', 'sha256'), 'hex')),
  1,
  'so the letter is still there — the cascade is what made this silent'
);

-- ---------------------------------------------------------------------------
-- The daily health summary
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
-- Independent of whatever else has run against this stack today: the claim is
-- a row, so the assertion below is about a database with no claim in it.
delete from private.audit_log where action = 'health.reported';

select pg_temp.act_as_service();

select is(
  public.dispatch_health_due(),
  (now() >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '8 hours'),
  'the day''s report is owed from 08:00 UTC and not before'
);

-- Reading the numbers claims nothing, which is what lets the sender claim the
-- day only once the letter is out. Claiming first meant a provider having a
-- bad morning took the whole day's report with it (review round 3).
select ok(
  public.dispatch_health(false) is not null and public.dispatch_health_due() = (
    now() >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '8 hours'),
  'and reading the numbers does not close the day'
);

select pg_temp.act_as_postgres();
insert into private.audit_log (action, resource_type, metadata)
values ('health.reported', 'account', '{}'::jsonb);

select pg_temp.act_as_service();
select ok(
  not public.dispatch_health_due(),
  'and once claimed it is not owed again, however many times the minute job runs'
);
select is(
  public.dispatch_health(true),
  null,
  'nor claimed twice'
);

select ok(
  (public.dispatch_health(false)) ?& array['failed_jobs_24h', 'stuck_outbox', 'suppressed_24h',
    'stuck_ready_plans', 'dispatcher_last_finished_at', 'retention_last_finished_at'],
  'reading it without claiming gives the four counts and the two lease times'
);

select ok(
  not jobs.carries_content(public.dispatch_health(false)),
  'and nothing in it is a name, an address or a sentence — it is the summary that gets emailed'
);

select cmp_ok(
  ((public.dispatch_health(false)) ->> 'failed_jobs_24h')::integer,
  '>=',
  1,
  'and the count is real: the job given up on above is in it'
);

select * from finish();
rollback;
