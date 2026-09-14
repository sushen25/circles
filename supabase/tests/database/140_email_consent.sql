-- Asking for plan-update email, and stopping it.
--
-- Two promises are under test here and they pull in opposite directions. The
-- product one: email is "optional, per meetup, verified, and stoppable without
-- sign-in" (spec §13), which means a link in a three-month-old email still has
-- to work. And the privacy one: nothing anybody does here may tell them
-- anything about an address they do not own — whether it exists, whether it is
-- verified, whether it bounced, whose it is.
--
-- So most of these assertions are about what *does not* happen: the write that
-- is not made for a suppressed address, the second email that is not sent to a
-- verified one, the difference that is not visible between four different
-- outcomes.

begin;
select plan(59);

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

/** A token's stored form. The readable one never reaches the database. */
create or replace function pg_temp.hash_of(token text) returns bytea
language sql as $$ select extensions.digest(token, 'sha256') $$;

/** One identity's contact for one address — there may be two. */
create or replace function pg_temp.contact_of(addr text, who uuid) returns uuid
language sql security definer as $$
  select c.id from private.email_contacts c
  where c.email_normalized = addr and c.user_id = who
$$;

-- Maya owns the circle; Jules is a guest who reads email; Nobody is elsewhere.
select pg_temp.make_user('00000000-0000-0000-0000-0000000008a1', 'Maya', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000008a2', 'Jules');
select pg_temp.make_user('00000000-0000-0000-0000-0000000008a3', 'Nobody');

select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-email');

select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-email';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000008a2'::uuid, 'Jules' from t;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000008a1',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pnemab'
from t;

create temporary table tp as select id as plan_id from public.plans where short_code = 'pnemab';
grant select on tp to anon, authenticated, service_role;
create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select plan_id from tp $$;

-- ---------------------------------------------------------------------------
-- Who may call any of this
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.request_email_updates(uuid, uuid, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.verify_email_contact(bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.email_preferences(bytea, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.issue_reentry_token(uuid, uuid, bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.issue_verification_token(uuid, bytea)', 'execute'),
  'no client role touches an address, a token or a consent record: the Edge Function is the door'
);
select ok(
  not has_function_privilege('anon', 'public.verify_email_contact(bytea)', 'execute')
  and not has_function_privilege('anon', 'public.email_preferences(bytea, text, uuid)', 'execute'),
  'and that is true of the two that take no session either — the token is the key, not the grant'
);

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select throws_ok(
  format($$ select public.request_email_updates(%L, %L, 'nobody@example.com',
       '2026-09-14', 't-nobody') $$,
    pg_temp.plan_id(), '00000000-0000-0000-0000-0000000008a3'),
  'plan_not_found',
  'somebody outside the circle cannot subscribe an address to its plan, and learns nothing from the refusal'
);

select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000008a2', 'jules@example.com',
     '2026-09-14', 't-first') ->> 'sent'),
  'true',
  'a member asks for email about their plan'
);

select pg_temp.act_as_postgres();
select is(
  (select array[c.status, c.email_normalized] from private.email_contacts c
   where c.email_normalized = 'jules@example.com'),
  array['pending', 'jules@example.com'],
  'the address is held once, pending, in the only table that holds one'
);

select is(
  (select array[s.status, s.consent_text_version] from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id
   where c.email_normalized = 'jules@example.com' and s.plan_id = pg_temp.plan_id()),
  array['active', '2026-09-14'],
  'with the consent recorded now, and the words it was given for'
);

-- Round 2's P1. Asking mints no token: `jobs.notification_jobs` carries ids and
-- no payload, so a token made here has no route to the letter and would expire
-- unused. The sender mints it (ADR 0020).
select is(
  (select count(*)::integer from private.email_action_tokens tok
   join private.email_contacts c on c.id = tok.contact_id
   where c.email_normalized = 'jules@example.com' and tok.purpose = 'verify'),
  0,
  'asking writes no token at all: the link is minted by whoever sends the email'
);

select is(
  (select count(*)::integer from jobs.notification_jobs j
   where j.kind = 'verify_email' and j.plan_id = pg_temp.plan_id()),
  1,
  'what it writes is one email to send'
);

-- Nothing is sent yet, and that is the point of verification.
select is(
  (select count(*)::integer from private.email_recipients_for(pg_temp.plan_id())),
  0,
  'an unverified contact receives nothing, however active the subscription says it is'
);

-- The dispatcher (S1-20) draws that job and mints the link it carries.
select pg_temp.act_as_service();
select ok(
  (select public.issue_verification_token(
     pg_temp.contact_of('jules@example.com', '00000000-0000-0000-0000-0000000008a2'),
     pg_temp.hash_of('t-first'))) is not null,
  'sending it is what mints the link, and only the digest reaches the table'
);

-- "Resend invalidates the previous token" (spec §5.8) — at the mint, because
-- that is where a token starts existing now.
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000008a2', 'jules@example.com',
     '2026-09-14', 't-second') ->> 'sent'),
  'true',
  'asking again sends again'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.notification_jobs j
   where j.kind = 'verify_email' and j.plan_id = pg_temp.plan_id()),
  2,
  'which is a second letter and not a duplicate: the request is the occurrence'
);

select pg_temp.act_as_service();
select ok(
  (select public.issue_verification_token(
     pg_temp.contact_of('jules@example.com', '00000000-0000-0000-0000-0000000008a2'),
     pg_temp.hash_of('t-second'))) is not null,
  'and sending the second one mints a second link'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_action_tokens tok
   join private.email_contacts c on c.id = tok.contact_id
   where c.email_normalized = 'jules@example.com' and tok.purpose = 'verify' and tok.used_at is null),
  1,
  'while the first link stops working: one live token, not two'
);

-- Round 1: one address, two people. Uniqueness has been `(email_hash, user_id)`
-- since 0009 — "two guest memberships may each be reachable at the same
-- address" (spec §9) — and the commonest real case is one person: a guest loses
-- their session, rejoins as a new identity, and asks again with the same
-- address. Refusing that told them "check your email" for ever.
select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000008a1', 'jules@example.com',
     '2026-09-14', 't-maya') ->> 'sent'),
  'true',
  'a second identity asking with the same address is answered, not silently refused'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_contacts c
   where c.email_normalized = 'jules@example.com'),
  2,
  'which is one contact per identity, as the constraint has said since 0009'
);

-- ---------------------------------------------------------------------------
-- A suppressed address is never written to again (spec §9)
-- ---------------------------------------------------------------------------
insert into private.email_suppressions (email_hash, reason)
values (pg_temp.hash_of('bounced@example.com'), 'bounced');

select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000008a2', 'bounced@example.com',
     '2026-09-14', 't-bounced') ->> 'sent'),
  'false',
  'a suppressed address is not resubscribed by somebody else asking'
);

select pg_temp.act_as_postgres();
select is(
  (select c.status from private.email_contacts c
   where c.email_normalized = 'bounced@example.com'),
  'suppressed',
  'the contact arrives suppressed, by the trigger that reads the tombstone — not pending'
);

select is(
  (select count(*)::integer from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id
   where c.email_normalized = 'bounced@example.com'),
  0,
  'and no consent, no token and no email are written for it'
);

-- ---------------------------------------------------------------------------
-- Verifying
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select throws_ok(
  $$ select public.verify_email_contact(extensions.digest('never-issued', 'sha256')) $$,
  'link_expired',
  'a token that was never ours says the same thing as one that is spent'
);

select is(
  (select public.verify_email_contact(pg_temp.hash_of('t-second')) ->> 'already_confirmed'),
  'false',
  'the live link verifies the address'
);

select pg_temp.act_as_postgres();
select is(
  (select array_agg(distinct c.status) from private.email_contacts c
   where c.email_normalized = 'jules@example.com'),
  array['verified'],
  'every contact holding that address is verified, not only the one the link named'
);

-- Round 1: and this is why. Retention deletes a *pending* contact after seven
-- days and the cascade takes its subscription, so a sibling left pending is a
-- consent that disappears without anybody withdrawing it.
select is(
  (select count(*)::integer from private.email_contacts c
   where c.email_normalized = 'jules@example.com' and c.status = 'pending'),
  0,
  'so no consent is left waiting to be deleted by retention'
);

select ok(
  (select count(*) from private.email_recipients_for(pg_temp.plan_id())) >= 1,
  'and now there is somebody to email about this plan'
);

select pg_temp.act_as_service();
select throws_ok(
  $$ select public.verify_email_contact(pg_temp.hash_of('t-second')) $$,
  'link_expired',
  'and the link is spent: two clicks on one link cannot both succeed'
);

-- A verified address is not asked to verify again.
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000008a2', 'jules@example.com',
     '2026-09-14', 't-again') ->> 'sent'),
  'false',
  'asking again on a verified address sends nothing: there is nothing left to prove'
);

-- And if a job for it were drained anyway — one queued before the click, say —
-- the sender is told there is nothing to mint rather than made to fail. Null is
-- "skip this job", which is what a verified, suppressed or removed contact is.
select ok(
  (select public.issue_verification_token(
     pg_temp.contact_of('jules@example.com', '00000000-0000-0000-0000-0000000008a2'),
     pg_temp.hash_of('t-too-late'))) is null,
  'and a queued verification for an address already proved mints nothing'
);

-- ---------------------------------------------------------------------------
-- Verifying after the plan is over, and after it is decided
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000008a1',
  'Over already', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pnemdn'
from t;

select pg_temp.make_user('00000000-0000-0000-0000-0000000008a4', 'Late');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000008a4'::uuid, 'Late' from t;

select pg_temp.act_as_service();
select public.request_email_updates(
  (select id from public.plans where short_code = 'pnemdn'),
  '00000000-0000-0000-0000-0000000008a4', 'late@example.com',
  '2026-09-14', 't-late');
select public.issue_verification_token(
  pg_temp.contact_of('late@example.com', '00000000-0000-0000-0000-0000000008a4'),
  pg_temp.hash_of('t-late'));

select pg_temp.act_as_postgres();
select planning.transition_plan(
  (select id from public.plans where short_code = 'pnemdn'), 'cancel',
  '00000000-0000-0000-0000-0000000008a1');

select pg_temp.act_as_service();
select is(
  (select public.verify_email_contact(pg_temp.hash_of('t-late')) -> 'active_plan_ids'),
  '[]'::jsonb,
  'verifying after the plan was called off activates nothing — no stale mail is sent (spec §9)'
);

select pg_temp.act_as_postgres();
select is(
  (select s.status from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id
   where c.email_normalized = 'late@example.com'),
  'withdrawn',
  'and the subscription is closed rather than left waiting for a plan that is over'
);

-- ---------------------------------------------------------------------------
-- Preferences, with no sign-in
-- ---------------------------------------------------------------------------
-- One contact's link, not the address's: a preferences token belongs to the row
-- it was issued for, and there are two rows for this address now.
insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
select c.id, 'prefs', pg_temp.hash_of('t-prefs'), now() + interval '90 days'
from private.email_contacts c
where c.email_normalized = 'jules@example.com'
  and c.user_id = '00000000-0000-0000-0000-0000000008a2';

select pg_temp.act_as_service();
select is(
  (select public.email_preferences(pg_temp.hash_of('t-prefs'), 'view')
   -> 'subscriptions' -> 0 ->> 'circle_name'),
  'Sunday Crew',
  'the page names the circle and the meetup, because a uuid is not a choice anybody can make'
);

select is(
  (select public.email_preferences(pg_temp.hash_of('t-prefs'), 'view') ->> 'removed'),
  'false',
  'and viewing changes nothing'
);

select lives_ok(
  format($$ select public.email_preferences(pg_temp.hash_of('t-prefs'), 'stop_plan', %L) $$,
    pg_temp.plan_id()),
  'one tap stops this meetup''s email'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_recipients_for(pg_temp.plan_id()) r
   join private.email_contacts c on c.id = r.contact_id
   where c.user_id = '00000000-0000-0000-0000-0000000008a2'),
  0,
  'and nothing more is sent to them about it'
);

-- Round 3's P1. The mailbox is what stops, not the row: "one copy per event"
-- is the dispatcher's `distinct email_hash` (0009), so a letter reaches this
-- mailbox carrying one contact's link — and stopping only that contact left the
-- next copy to be sent through the sibling, to the same inbox, about the same
-- meetup, after somebody tapped the Spam Act's one-tap unsubscribe.
select is(
  (select count(*)::integer from private.email_recipients_for(pg_temp.plan_id())),
  0,
  'and no other contact at that address hears about it either: the tap stops the mailbox'
);

select is(
  (select count(*)::integer from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id
   where c.email_normalized = 'jules@example.com' and s.status = 'active'),
  0,
  'which is both consents withdrawn, each with an event of its own'
);

select is(
  (select c.status from private.email_contacts c
   where c.email_normalized = 'jules@example.com'
     and c.user_id = '00000000-0000-0000-0000-0000000008a2'),
  'verified',
  'and the address itself is untouched: stopping one meetup is not asking to be forgotten'
);

select pg_temp.act_as_service();
select is(
  (select public.email_preferences(pg_temp.hash_of('t-prefs'), 'remove_contact') ->> 'removed'),
  'true',
  'and asking to be forgotten is the other link'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_contacts c
   where c.email_normalized = 'jules@example.com'
     and c.user_id = '00000000-0000-0000-0000-0000000008a2'),
  0,
  'which takes the address with it: "remove" has to mean the plaintext is gone (§14)'
);

select is(
  (select count(*)::integer from private.email_suppressions s
   where s.email_hash = pg_temp.hash_of('jules@example.com')),
  1,
  'while the hash stays, where nothing deletes it — so re-adding the address cannot restart the email'
);

-- Round 2's P1: and the sibling goes with it. Suppression crosses the rows (the
-- trigger does that), but retention never deletes a suppressed contact — so
-- marking the sibling and stopping there left the plaintext address sitting in
-- it for ever, which is exactly what the link promised to undo.
select is(
  (select count(*)::integer from private.email_contacts c
   where c.email_normalized = 'jules@example.com'),
  0,
  'and no row holding that address is left anywhere, not even a suppressed one'
);

-- Every consent at that address *ended* — it did not merely vanish with the
-- row it hung from. Maya's was still live when the link was tapped, so there is
-- an event saying it was withdrawn; a subscription that disappeared under a
-- cascade would have told nothing downstream.
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'communication.subscription_changed'
     and o.payload ->> 'status' = 'withdrawn'
     and o.payload ->> 'plan_id' = pg_temp.plan_id()::text),
  2,
  'and every consent at that address ended on the record: one stopped, one removed'
);

select pg_temp.act_as_service();
select throws_ok(
  $$ select public.email_preferences(pg_temp.hash_of('t-prefs'), 'view') $$,
  'link_expired',
  'the link itself stops working, which is the honest state for a contact that is gone'
);

select pg_temp.act_as_service();
select throws_ok(
  $$ select public.email_preferences(extensions.digest('not-a-prefs-token', 'sha256'), 'view') $$,
  'link_expired',
  'a preferences link that is not ours says the same as one that has expired'
);

-- ---------------------------------------------------------------------------
-- Round 2: what the page says has to be what will happen
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('00000000-0000-0000-0000-0000000008a4', 'bouncing@example.com', 'verified', now());

insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, status, consent_text_version)
select c.id, c.user_id, 'plan_updates', pg_temp.plan_id(), 'active', '2026-09-14'
from private.email_contacts c where c.email_normalized = 'bouncing@example.com';

insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
select c.id, 'prefs', pg_temp.hash_of('t-bounce-prefs'), now() + interval '90 days'
from private.email_contacts c where c.email_normalized = 'bouncing@example.com';

select pg_temp.act_as_service();
select is(
  (select public.email_preferences(pg_temp.hash_of('t-bounce-prefs'), 'view')
   -> 'subscriptions' -> 0 ->> 'active'),
  'true',
  'a verified contact with a live subscription reads as on'
);

-- A bounce suppresses the contact and leaves the subscription alone: nobody
-- withdrew it. `email_recipients_for` skips it all the same, so a page that
-- read the subscription only would tell somebody email was coming when it
-- never would.
select pg_temp.act_as_postgres();
update private.email_contacts
set status = 'suppressed', suppressed_at = now(), suppression_reason = 'bounced', verified_at = null
where email_normalized = 'bouncing@example.com';

select pg_temp.act_as_service();
select is(
  (select public.email_preferences(pg_temp.hash_of('t-bounce-prefs'), 'view')
   -> 'subscriptions' -> 0 ->> 'active'),
  'false',
  'and after a bounce it reads as off, which is what will actually happen'
);

-- ---------------------------------------------------------------------------
-- Round 1: a plan that is over, and a member who has left
--
-- Two ways an email can be stale, and neither of them is about the address.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'cancelled', '00000000-0000-0000-0000-0000000008a1',
  'Called off', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pnemgn'
from t;

select pg_temp.make_user('00000000-0000-0000-0000-0000000008a5', 'Asker');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000008a5'::uuid, 'Asker' from t;

select pg_temp.act_as_service();
select throws_ok(
  format($$ select public.request_email_updates(%L, %L, 'asker@example.com',
       '2026-09-14', 't-over') $$,
    (select id from public.plans where short_code = 'pnemgn'),
    '00000000-0000-0000-0000-0000000008a5'),
  'plan_is_finished',
  'nobody is asked to verify an address for a meetup that is already off'
);

-- A member who is removed between asking and verifying hears nothing more: the
-- plan is not theirs any more, whatever channel it would have reached them on.
select pg_temp.act_as_postgres();
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'ready', '00000000-0000-0000-0000-0000000008a1',
  'Left behind', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pnemhn'
from t;

select pg_temp.make_user('00000000-0000-0000-0000-0000000008a6', 'Departing');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000008a6'::uuid, 'Departing' from t;
insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '00000000-0000-0000-0000-0000000008a6'::uuid
from public.plans where short_code = 'pnemhn';

select pg_temp.act_as_service();
select public.request_email_updates(
  (select id from public.plans where short_code = 'pnemhn'),
  '00000000-0000-0000-0000-0000000008a6', 'departing@example.com',
  '2026-09-14', 't-departing');
select public.issue_verification_token(
  pg_temp.contact_of('departing@example.com', '00000000-0000-0000-0000-0000000008a6'),
  pg_temp.hash_of('t-departing'));

-- The meetup is locked in, and then they leave.
select pg_temp.act_as_postgres();
insert into public.candidate_sets (
  plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select p.id, p.revision, p.input_version, p.scoring_version, 'seed', 10, 1, 1, 3
from public.plans p where p.short_code = 'pnemhn';

insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select cs.id, false, 1, timestamptz '2099-09-17T08:30:00Z', timestamptz '2099-09-17T10:30:00Z',
  array['00000000-0000-0000-0000-0000000008a6'::uuid], 1, 0, 'best_attendance', 1
from public.candidate_sets cs
join public.plans p on p.id = cs.plan_id where p.short_code = 'pnemhn';

select planning.transition_plan(
  (select id from public.plans where short_code = 'pnemhn'), 'confirm',
  '00000000-0000-0000-0000-0000000008a1',
  jsonb_build_object('candidate_id', '2099-09-17T08:30:00+00:00'));

update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t)
  and user_id = '00000000-0000-0000-0000-0000000008a6';

select pg_temp.act_as_service();
select is(
  (select public.verify_email_contact(pg_temp.hash_of('t-departing')) -> 'active_plan_ids'),
  '[]'::jsonb,
  'somebody removed from the circle hears about none of its plans, however verified their address'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.notification_jobs j
   join private.email_contacts c on c.id = j.contact_id
   where c.email_normalized = 'departing@example.com' and j.kind = 'locked_in'),
  0,
  'and no "locked in" is queued for them: the plan stopped being theirs when the membership did'
);

-- Round 3's P1: what the page says has to be what will happen, and a plan whose
-- circle they have left is neither. `email_recipients_for` is the one query
-- that decides, so the page asks it rather than restating two of its three
-- conditions — restating them is how "verified and active" came to say yes to
-- somebody who had been removed, and how the row went on showing the plan's
-- title as it is edited afterwards.
select pg_temp.act_as_postgres();
insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
select c.id, 'prefs', pg_temp.hash_of('t-left-prefs'), now() + interval '90 days'
from private.email_contacts c where c.email_normalized = 'departing@example.com';

select pg_temp.act_as_service();
select is(
  (select public.email_preferences(pg_temp.hash_of('t-left-prefs'), 'view') -> 'subscriptions'),
  '[]'::jsonb,
  'somebody removed from the circle is shown none of its plans, and not their titles'
);


-- ---------------------------------------------------------------------------
-- The way back in
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('00000000-0000-0000-0000-0000000008a2', 'jules-again@example.com', 'verified', now());

select pg_temp.act_as_service();
select lives_ok(
  format($$ select public.issue_reentry_token(%L, %L, pg_temp.hash_of('t-reentry')) $$,
    (select circle_id from t), '00000000-0000-0000-0000-0000000008a2'),
  'a guest gets a single-use way back into the circle'
);

select pg_temp.act_as_postgres();
select ok(
  (select tok.expires_at between now() + interval '6 days' and now() + interval '8 days'
   from private.email_action_tokens tok where tok.purpose = 'reentry'),
  'good for seven days, and no longer'
);

-- And never for somebody who can simply sign in: a re-entry link for a
-- saved-place identity is a sign-in bypass, refused by the table rather than by
-- whoever remembers.
select pg_temp.act_as_service();
select ok(
  (select public.issue_reentry_token(
     (select circle_id from t), '00000000-0000-0000-0000-0000000008a1',
     extensions.digest('t-maya-reentry', 'sha256'))) is null,
  'and the owner, who signs in, gets null: the email is the same without a link'
);

-- Round 2: null, not a raise. The table's guard raises `check_violation`, which
-- nothing translates — a 500 for an email that simply has no link in it. The
-- guard stays; this is the answer the one caller needs.
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_action_tokens tok
   where tok.purpose = 'reentry'
     and tok.membership_user_id = '00000000-0000-0000-0000-0000000008a1'),
  0,
  'and nothing was written for them either'
);

-- A guest with no verified address is a different thing, and still an error:
-- a re-entry link travels in an email, so there has to be one.
select pg_temp.act_as_service();
select throws_ok(
  format($$ select public.issue_reentry_token(%L, %L, extensions.digest('t-asker', 'sha256')) $$,
    (select circle_id from t), '00000000-0000-0000-0000-0000000008a5'),
  'no_verified_contact',
  'while a guest with no address to send it to is told so'
);

-- ---------------------------------------------------------------------------
-- Round 2: two people, one mailbox, one of their meetups decided
--
-- Verification crosses the address (0009), so one click proves it for both. The
-- two things that must *not* cross it are the letter's recipient and the
-- answer's contents: a job written against the clicking contact for somebody
-- else's plan names a person who is not in that circle — the dispatcher would
-- address it to the wrong contact, its re-entry link would raise `not_a_member`
-- and its "stop this meetup" link would point at a subscription that is not
-- there. And the browser holding the click belongs to one identity.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select pg_temp.make_user('00000000-0000-0000-0000-0000000008a7', 'Twin One');
select pg_temp.make_user('00000000-0000-0000-0000-0000000008a8', 'Twin Two');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000008a7'::uuid, 'Twin One' from t;
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000008a8'::uuid, 'Twin Two' from t;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000008a1',
  'Twin one''s', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pnemra'
from t;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'ready', '00000000-0000-0000-0000-0000000008a1',
  'Twin two''s', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'pnemrb'
from t;

insert into public.plan_participants (plan_id, revision, user_id)
select id, 1, '00000000-0000-0000-0000-0000000008a8'::uuid
from public.plans where short_code = 'pnemrb';

-- Both of them ask, at the same address.
select pg_temp.act_as_service();
select public.request_email_updates(
  (select id from public.plans where short_code = 'pnemra'),
  '00000000-0000-0000-0000-0000000008a7', 'twins@example.com', '2026-09-14', 't-twin-one');
select public.request_email_updates(
  (select id from public.plans where short_code = 'pnemrb'),
  '00000000-0000-0000-0000-0000000008a8', 'twins@example.com', '2026-09-14', 't-twin-two');
select public.issue_verification_token(
  pg_temp.contact_of('twins@example.com', '00000000-0000-0000-0000-0000000008a7'),
  pg_temp.hash_of('t-twin-one'));

-- The second one's meetup is locked in before either link is clicked.
select pg_temp.act_as_postgres();
insert into public.candidate_sets (
  plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select p.id, p.revision, p.input_version, p.scoring_version, 'seed', 10, 1, 1, 4
from public.plans p where p.short_code = 'pnemrb';

insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select cs.id, false, 1, timestamptz '2099-09-18T08:30:00Z', timestamptz '2099-09-18T10:30:00Z',
  array['00000000-0000-0000-0000-0000000008a8'::uuid], 1, 0, 'best_attendance', 1
from public.candidate_sets cs
join public.plans p on p.id = cs.plan_id where p.short_code = 'pnemrb';

select planning.transition_plan(
  (select id from public.plans where short_code = 'pnemrb'), 'confirm',
  '00000000-0000-0000-0000-0000000008a1',
  jsonb_build_object('candidate_id', '2099-09-18T08:30:00+00:00'));

-- Twin One clicks.
select pg_temp.act_as_service();
select is(
  (select public.verify_email_contact(pg_temp.hash_of('t-twin-one')) -> 'active_plan_ids'),
  to_jsonb(array[(select id from public.plans where short_code = 'pnemra')]),
  'the click answers with the clicking identity''s own plans, and not the other twin''s'
);

select throws_ok(
  $$ select public.verify_email_contact(pg_temp.hash_of('t-twin-one')) $$,
  'link_expired',
  'and the link is spent, so there is no second answer to read either'
);

select pg_temp.act_as_postgres();
select is(
  (select array_agg(distinct c.status) from private.email_contacts c
   where c.email_normalized = 'twins@example.com'),
  array['verified'],
  'while the address itself is proved for both of them: that is what was proved'
);

-- Two rows, so that the assertion below is comparing two different contacts
-- rather than one contact with itself.
select is(
  (select count(*)::integer from private.email_contacts c
   where c.email_normalized = 'twins@example.com'),
  2,
  'there really are two contacts at that address'
);

select is(
  (select j.contact_id from jobs.notification_jobs j
   where j.kind = 'locked_in'
     and j.plan_id = (select id from public.plans where short_code = 'pnemrb')),
  pg_temp.contact_of('twins@example.com', '00000000-0000-0000-0000-0000000008a8'),
  'and the "locked in" for the other twin''s meetup is addressed to the contact that subscribed to it'
);


select * from finish();
rollback;
