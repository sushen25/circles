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
select plan(43);

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
  not has_function_privilege('authenticated', 'public.request_email_updates(uuid, uuid, text, bytea, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.verify_email_contact(bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.email_preferences(bytea, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.issue_reentry_token(uuid, uuid, bytea)', 'execute'),
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
       pg_temp.hash_of('t-nobody'), '2026-09-14') $$,
    pg_temp.plan_id(), '00000000-0000-0000-0000-0000000008a3'),
  'plan_not_found',
  'somebody outside the circle cannot subscribe an address to its plan, and learns nothing from the refusal'
);

select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000008a2', 'jules@example.com',
     pg_temp.hash_of('t-first'), '2026-09-14') ->> 'sent'),
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

select is(
  (select count(*)::integer from private.email_action_tokens tok
   join private.email_contacts c on c.id = tok.contact_id
   where c.email_normalized = 'jules@example.com' and tok.purpose = 'verify' and tok.used_at is null),
  1,
  'one live verification token'
);

select is(
  (select count(*)::integer from jobs.notification_jobs j
   where j.kind = 'verify_email' and j.plan_id = pg_temp.plan_id()),
  1,
  'and one email to send'
);

-- Nothing is sent yet, and that is the point of verification.
select is(
  (select count(*)::integer from private.email_recipients_for(pg_temp.plan_id())),
  0,
  'an unverified contact receives nothing, however active the subscription says it is'
);

-- "Resend invalidates the previous token" (spec §5.8).
select pg_temp.act_as_service();
select is(
  (select public.request_email_updates(pg_temp.plan_id(),
     '00000000-0000-0000-0000-0000000008a2', 'jules@example.com',
     pg_temp.hash_of('t-second'), '2026-09-14') ->> 'sent'),
  'true',
  'asking again sends again'
);

select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.email_action_tokens tok
   join private.email_contacts c on c.id = tok.contact_id
   where c.email_normalized = 'jules@example.com' and tok.purpose = 'verify' and tok.used_at is null),
  1,
  'and the first link stops working: one live token, not two'
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
     pg_temp.hash_of('t-maya'), '2026-09-14') ->> 'sent'),
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
     pg_temp.hash_of('t-bounced'), '2026-09-14') ->> 'sent'),
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
     pg_temp.hash_of('t-again'), '2026-09-14') ->> 'sent'),
  'false',
  'asking again on a verified address sends nothing: there is nothing left to prove'
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
  pg_temp.hash_of('t-late'), '2026-09-14');

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

-- The other identity reachable at the same address is untouched: a preferences
-- link belongs to the contact it was issued for, and stopping one person's
-- email is not stopping everybody's.
select ok(
  (select count(*) from private.email_recipients_for(pg_temp.plan_id())) >= 1,
  'while the other contact for that address, which nobody stopped, still hears about it'
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

-- And the sibling contact for the same address is suppressed with it, by the
-- trigger: suppression is the address's, not the row's.
select is(
  (select c.status from private.email_contacts c
   where c.email_normalized = 'jules@example.com'
     and c.user_id = '00000000-0000-0000-0000-0000000008a1'),
  'suppressed',
  'and every other contact holding that address stops too'
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
       pg_temp.hash_of('t-over'), '2026-09-14') $$,
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
  pg_temp.hash_of('t-departing'), '2026-09-14');

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
select throws_ok(
  format($$ select public.issue_reentry_token(%L, %L, extensions.digest('t-maya-reentry', 'sha256')) $$,
    (select circle_id from t), '00000000-0000-0000-0000-0000000008a1'),
  'no_verified_contact',
  'and the owner, who signs in, has no re-entry link to be issued'
);

select * from finish();
rollback;
