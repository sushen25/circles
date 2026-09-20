-- Sending email, and hearing back about it (S1-19).
--
-- Two functions the sender calls and one the provider's webhook calls. The
-- promise under test is the one a bounce makes: an address that bounced hard
-- or complained is never mailed again — not through the contact the message
-- went to, not through a sibling contact at the same address, not through a
-- queued job, and not through a contact created for it later.

begin;
select plan(28);

create or replace function pg_temp.make_user(id uuid, name text, permanent boolean default false)
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

create or replace function pg_temp.status_of(addr text, who uuid) returns text
language sql security definer as $$
  select c.status from private.email_contacts c
  where c.email_normalized = addr and c.user_id = who
$$;

/** A job the dispatcher has sent, as it will have recorded it. */
create or replace function pg_temp.sent_job(contact uuid, plan uuid, message_id text, key text)
returns uuid language sql security definer as $$
  insert into jobs.notification_jobs (
    channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key,
    status, sent_at, provider_message_id
  ) values (
    'email', 'locked_in', contact, plan, 1, now(),
    encode(extensions.digest(key, 'sha256'), 'hex'), 'sent', now(), message_id
  ) returning id;
$$;

-- Maya owns the circle. Priya is a guest reading email at one address, and
-- Priya's second identity (a lost session, joined again) holds the same one.
select pg_temp.make_user('00000000-0000-0000-0000-0000000018a1', 'Maya', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000018a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000018a3', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000018a4', 'Tom');

select pg_temp.act_as('00000000-0000-0000-0000-0000000018a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-delivery');

select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id from public.circles where creation_key = 'key-delivery';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t,
  (values ('00000000-0000-0000-0000-0000000018a2'::uuid, 'Priya'),
          ('00000000-0000-0000-0000-0000000018a3'::uuid, 'Priya 2'),
          ('00000000-0000-0000-0000-0000000018a4'::uuid, 'Tom')) as u (id, name);

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000018a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pdecvr'
from t;

create temporary table tp as select id as plan_id from public.plans where short_code = 'pdecvr';
grant select on tp to anon, authenticated, service_role;

insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values
  ('00000000-0000-0000-0000-0000000018a2', 'priya@example.com', 'verified', now()),
  ('00000000-0000-0000-0000-0000000018a3', 'priya@example.com', 'verified', now()),
  ('00000000-0000-0000-0000-0000000018a4', 'tom@example.com', 'verified', now());
insert into private.email_contacts (user_id, email_normalized)
values ('00000000-0000-0000-0000-0000000018a4', 'tom-pending@example.com');

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select c.id, c.user_id, 'plan_updates', (select plan_id from tp), '2026-09-14'
from private.email_contacts c where c.status = 'verified';

-- ---------------------------------------------------------------------------
-- Who may call any of this
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.record_email_delivery(text, text, timestamptz, boolean, bytea)', 'execute')
  and not has_function_privilege('anon', 'public.record_email_delivery(text, text, timestamptz, boolean, bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.issue_preferences_token(uuid, bytea)', 'execute')
  and not has_function_privilege('anon', 'public.issue_preferences_token(uuid, bytea)', 'execute'),
  'no client role records a delivery or mints a link: the webhook and the sender are the door'
);
select ok(
  has_function_privilege('service_role', 'public.record_email_delivery(text, text, timestamptz, boolean, bytea)', 'execute')
  and has_function_privilege('service_role', 'public.issue_preferences_token(uuid, bytea)', 'execute'),
  'and the service role does'
);

-- ---------------------------------------------------------------------------
-- The preferences token, minted with each email
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select isnt(
  public.issue_preferences_token(
    pg_temp.contact_of('tom@example.com', '00000000-0000-0000-0000-0000000018a4'),
    extensions.digest('t-tom-prefs-1', 'sha256')),
  null,
  'a verified contact gets a preferences link for the email being sent'
);

select pg_temp.act_as_postgres();
select ok(
  (select tok.expires_at between now() + interval '89 days' and now() + interval '91 days'
     and tok.used_at is null
   from private.email_action_tokens tok
   where tok.token_hash = extensions.digest('t-tom-prefs-1', 'sha256') and tok.purpose = 'prefs'),
  'good for ninety days (ADR 0019)'
);

select pg_temp.act_as_service();
select isnt(
  public.issue_preferences_token(
    pg_temp.contact_of('tom@example.com', '00000000-0000-0000-0000-0000000018a4'),
    extensions.digest('t-tom-prefs-2', 'sha256')),
  null,
  'and the next email gets its own'
);
select is(
  jsonb_array_length(public.email_preferences(extensions.digest('t-tom-prefs-1', 'sha256'), 'view') -> 'subscriptions'),
  1,
  'and the first one still opens the page: minting another does not spend it'
);
select is(
  jsonb_array_length(public.email_preferences(extensions.digest('t-tom-prefs-1', 'sha256'), 'view') -> 'subscriptions'),
  1,
  'twice: a preferences link is not consumed by being used'
);

select is(
  public.issue_preferences_token(
    pg_temp.contact_of('tom-pending@example.com', '00000000-0000-0000-0000-0000000018a4'),
    extensions.digest('t-pending-prefs', 'sha256')),
  null,
  'a contact that has not verified gets null: there is no plan-update email to put it in'
);
select is(
  public.issue_preferences_token(
    '00000000-0000-0000-0000-0000000018ff', extensions.digest('t-nobody-prefs', 'sha256')),
  null,
  'and so does a contact that no longer exists'
);

-- ---------------------------------------------------------------------------
-- Stored once
-- ---------------------------------------------------------------------------
select pg_temp.sent_job(
  pg_temp.contact_of('tom@example.com', '00000000-0000-0000-0000-0000000018a4'),
  (select plan_id from tp), 'msg-tom-1', 'k-tom-1');

select is(
  public.record_email_delivery('msg-tom-1', 'delivered', now(), true, null) -> 'recorded',
  'true'::jsonb,
  'a delivery is recorded'
);
select is(
  public.record_email_delivery('msg-tom-1', 'delivered', now(), true, null)
    - 'circle_id' - 'plan_id' - 'contact_id',
  '{"recorded": false, "suppressed": false}'::jsonb,
  'and the same event again is not: the provider retried, or somebody replayed it'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_delivery_events where provider_message_id = 'msg-tom-1'),
  1,
  'one row for one event, however many times it arrives'
);
select is(
  (select job_id from private.email_delivery_events where provider_message_id = 'msg-tom-1'),
  (select id from jobs.notification_jobs where provider_message_id = 'msg-tom-1'),
  'tied to the job the message was sent for'
);
select is(
  (select count(*)::integer from jobs.outbox
   where event_name = 'communication.delivery_recorded'
     and payload ->> 'job_id' = (select id::text from jobs.notification_jobs where provider_message_id = 'msg-tom-1')),
  1,
  'and announced once, by ids'
);

select pg_temp.act_as_service();
select is(
  (public.record_email_delivery('msg-tom-1', 'delivered', now(), true, null) ->> 'plan_id')::uuid,
  (select plan_id from tp),
  'the answer names the plan, for the analytics event — and nothing about the address'
);

select throws_ok(
  $$ select public.record_email_delivery('msg-tom-1', 'opened', now(), true, null) $$,
  'unknown_delivery_event',
  'an event the product does not record is refused, not stored'
);

-- ---------------------------------------------------------------------------
-- A soft bounce changes nothing
-- ---------------------------------------------------------------------------
select is(
  public.record_email_delivery('msg-tom-1', 'bounced', now(), false, null) -> 'suppressed',
  'false'::jsonb,
  'a transient bounce is stored and suppresses nothing'
);
select is(
  pg_temp.status_of('tom@example.com', '00000000-0000-0000-0000-0000000018a4'),
  'verified',
  'so a full mailbox today is not a lost reader for ever'
);

-- ---------------------------------------------------------------------------
-- A complaint suppresses the address: every contact, subscription and job
-- ---------------------------------------------------------------------------
select pg_temp.sent_job(
  pg_temp.contact_of('priya@example.com', '00000000-0000-0000-0000-0000000018a2'),
  (select plan_id from tp), 'msg-priya-1', 'k-priya-1');

select pg_temp.act_as_postgres();
-- A reminder queued for Priya's second identity, at the same address.
insert into jobs.notification_jobs (
  channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
) values (
  'email', 'reminder', pg_temp.contact_of('priya@example.com', '00000000-0000-0000-0000-0000000018a3'),
  (select plan_id from tp), 1, now() + interval '1 day',
  encode(extensions.digest('k-priya-reminder', 'sha256'), 'hex')
);

select pg_temp.act_as_service();
select is(
  public.record_email_delivery('msg-priya-1', 'complained', now(), true,
    extensions.digest('priya@example.com', 'sha256')) -> 'suppressed',
  'true'::jsonb,
  'a complaint suppresses'
);

select is(
  array[
    pg_temp.status_of('priya@example.com', '00000000-0000-0000-0000-0000000018a2'),
    pg_temp.status_of('priya@example.com', '00000000-0000-0000-0000-0000000018a3')
  ],
  array['suppressed', 'suppressed'],
  'the contact the message went to, and the sibling holding the same address'
);

select pg_temp.act_as_postgres();
select is(
  (select array_agg(distinct s.status) from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id
   where c.email_normalized = 'priya@example.com'),
  array['withdrawn'],
  'every subscription at the address is withdrawn'
);
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'communication.subscription_changed'
     and o.payload ->> 'status' = 'withdrawn'
     and (o.payload ->> 'contact_id')::uuid in (
       select id from private.email_contacts where email_normalized = 'priya@example.com')),
  2,
  'each with an event of its own'
);
select is(
  (select status || ':' || last_error from jobs.notification_jobs
   where idempotency_key = encode(extensions.digest('k-priya-reminder', 'sha256'), 'hex')),
  'skipped:suppressed',
  'and the reminder still queued for it will not be sent'
);
select is(
  (select reason from private.email_suppressions
   where email_hash = extensions.digest('priya@example.com', 'sha256')),
  'complained',
  'the tombstone says why, and outlives the contacts'
);
select is(
  pg_temp.status_of('tom@example.com', '00000000-0000-0000-0000-0000000018a4'),
  'verified',
  'and nobody else at another address is touched'
);

-- ---------------------------------------------------------------------------
-- A hard bounce with no job and no contact left still leaves a tombstone
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(
  public.record_email_delivery('msg-gone-1', 'bounced', now(), true,
    extensions.digest('gone@example.com', 'sha256')) - 'circle_id' - 'plan_id' - 'contact_id',
  '{"recorded": true, "suppressed": true}'::jsonb,
  'a hard bounce for an address nobody holds any more is still recorded as one'
);

select pg_temp.act_as_postgres();
insert into private.email_contacts (user_id, email_normalized)
values ('00000000-0000-0000-0000-0000000018a4', 'gone@example.com');
select is(
  pg_temp.status_of('gone@example.com', '00000000-0000-0000-0000-0000000018a4'),
  'suppressed',
  'so the address arrives suppressed when somebody adds it again'
);

-- ---------------------------------------------------------------------------
-- Without the address, the job's contact is the fallback
-- ---------------------------------------------------------------------------
select pg_temp.sent_job(
  pg_temp.contact_of('tom@example.com', '00000000-0000-0000-0000-0000000018a4'),
  (select plan_id from tp), 'msg-tom-2', 'k-tom-2');
select pg_temp.act_as_service();
select public.record_email_delivery('msg-tom-2', 'bounced', now(), true, null);
select is(
  pg_temp.status_of('tom@example.com', '00000000-0000-0000-0000-0000000018a4'),
  'suppressed',
  'a hard bounce with no recipient in it suppresses the contact its job was for'
);

select * from finish();
rollback;
