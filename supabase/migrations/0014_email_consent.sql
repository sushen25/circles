-- ---------------------------------------------------------------------------
-- 0014 — asking for plan-update email, and stopping it (S1-18).
--
-- No new tables: `email_contacts`, `email_subscriptions`, `email_action_tokens`
-- and `email_suppressions` have been in `private` since 0006. What was missing
-- was the four functions that write them, and the one that reads them:
--
--   `public.request_email_updates`   consent, token and job, in one transaction
--   `public.verify_email_contact`    the link, consumed in one statement
--   `public.email_preferences`       stopping it, with no sign-in
--   `public.issue_reentry_token`     the way back for a guest with no session
--   `private.email_recipients_for`   who may be emailed about a plan
--   `jobs.idempotency_key`           architecture §13's key, in SQL
--
-- All five are `service_role` only. The endpoints above them are the door: two
-- of them take no session at all, because a link in an email is opened by
-- somebody who may have no account — and what authorises those is the token,
-- which is ≥256 bits, stored only as a digest, and single-use or expiring by
-- purpose (§14).
--
-- The last one is the join the dispatcher (S1-20) needs and should not write
-- for itself: a verified contact, an active subscription and an active
-- membership. Dropping any one of the three sends mail somebody did not ask
-- for, and "a **verified** email subscription" is what the domain's
-- `hasPlanEmailSubscription` has always meant.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/jobs/idempotency_key.sql
-- ---------------------------------------------------------------------------
-- `hash(channel, recipient, plan, revision, kind, occurrence)` — architecture
-- §13's key, in SQL.
--
-- The formula belongs to `packages/domain/communication/idempotency.ts` and is
-- written twice only because both writers need it: the dispatcher computes keys
-- in TypeScript, and the functions that enqueue an email from inside a
-- transaction know ids — a token's, a confirmation's — that no caller could
-- have passed in. A key composed two different ways is two jobs where the
-- unique index was meant to allow one, which is a second email to somebody who
-- has already had it.
--
-- So this mirrors the canonical form exactly, length prefixes and all: a plain
-- separator would let `('ab','c')` and `('a','bc')` collide, and a collision
-- here is a notification that silently never arrives. `130_jobs_keys.sql` pins
-- it to a value the domain's own function produces, so the two cannot drift
-- without a test saying so.
-- ---------------------------------------------------------------------------

create or replace function jobs.idempotency_key(
  p_channel text,
  p_recipient text,
  p_plan text,
  p_revision text,
  p_kind text,
  p_occurrence text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat(
        length(p_channel), ':', p_channel,
        length(p_recipient), ':', p_recipient,
        length(coalesce(p_plan, '')), ':', coalesce(p_plan, ''),
        length(coalesce(p_revision, '')), ':', coalesce(p_revision, ''),
        length(p_kind), ':', p_kind,
        length(p_occurrence), ':', p_occurrence
      ),
      'sha256'
    ),
    'hex'
  );
$$;

comment on function jobs.idempotency_key(text, text, text, text, text, text) is
  'The notification idempotency key of architecture §13, mirroring idempotencyKey() in packages/domain. Pinned to the domain''s output by 130_jobs_keys.sql.';

revoke all on function jobs.idempotency_key(text, text, text, text, text, text) from public;
revoke all on function jobs.idempotency_key(text, text, text, text, text, text) from anon, authenticated;
grant execute on function jobs.idempotency_key(text, text, text, text, text, text) to service_role;

-- supabase/sql/functions/private/email_recipients_for.sql
-- ---------------------------------------------------------------------------
-- Who may be emailed about a plan.
--
-- Written once, here, because it is the join that "a **verified** email
-- subscription to this plan" (the domain's `hasPlanEmailSubscription`) actually
-- means, and because the dispatcher (S1-20) is not the place to work it out
-- again. Three conditions, and dropping any one of them sends mail somebody did
-- not ask for:
--
--   * the contact is **verified** — an address typed wrong has a pending
--     contact, and consent recorded against it is consent from whoever owns the
--     address, not from whoever typed it;
--   * the subscription is **active** — asked for, and not stopped since;
--   * the person is still an **active member** of the circle, because "only
--     active members see or act on it" (AGENTS.md) does not stop being true
--     because the channel is email.
--
-- It returns ids, never addresses: the address is read once, by the sender,
-- from the row this points at.
-- ---------------------------------------------------------------------------

create or replace function private.email_recipients_for(p_plan_id uuid)
returns table (contact_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.user_id
  from private.email_subscriptions s
  join private.email_contacts c on c.id = s.contact_id
  join public.plans p on p.id = s.plan_id
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = c.user_id
  where s.plan_id = p_plan_id
    and s.scope = 'plan_updates'
    and s.status = 'active'
    and c.status = 'verified'
    and m.status = 'active'
  order by c.id;
$$;

comment on function private.email_recipients_for(uuid) is
  'The contacts that may receive plan-update email for one plan: verified contact, active subscription, active member. Ids only, never addresses.';

revoke all on function private.email_recipients_for(uuid) from public;
revoke all on function private.email_recipients_for(uuid) from anon, authenticated;
grant execute on function private.email_recipients_for(uuid) to service_role;

-- supabase/sql/functions/public/email_preferences.sql
-- ---------------------------------------------------------------------------
-- Stopping the email, without signing in.
--
-- The Spam Act's unsubscribe, answered in one tap, for somebody who may have no
-- account and no memory of the circle (spec §5.8, §13). The token is long-lived
-- — a link in an email from three months ago still has to work — and, unlike
-- the verification one, is **not** consumed: an unsubscribe link that worked
-- once and then expired would be an unsubscribe link that does not work.
--
-- What it can reach is one contact's own subscriptions and nothing else. It
-- names the circle and the plan because an unauthenticated page cannot ask
-- somebody to choose between two uuids, and those two names are what the email
-- that carried this link already told this reader. No member names, no
-- addresses, no quiet-ask state.
--
-- `remove_contact` deletes the contact rather than marking it: the address is
-- the private thing, and "remove" has to mean the address is gone. What stays
-- is the hash in `email_suppressions`, which is what makes the promise
-- permanent — a contact created for that address later arrives suppressed.
-- ---------------------------------------------------------------------------

create or replace function public.email_preferences(
  p_token_hash bytea,
  p_action text,
  p_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token private.email_action_tokens;
  stopped private.email_subscriptions;
  removed boolean := false;
begin
  select * into token
  from private.email_action_tokens t
  where t.token_hash = p_token_hash and t.purpose = 'prefs' and t.expires_at > now();

  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  if p_action = 'stop_plan' then
    -- Immediately, and only this plan's. "Stop emails for this meetup" is the
    -- narrow one, offered in every event email beside the broader link.
    update private.email_subscriptions s
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where s.contact_id = token.contact_id
      and s.plan_id = p_plan_id
      and s.status = 'active'
    returning * into stopped;

    if stopped.id is not null then
      perform jobs.emit('communication.subscription_changed', 'subscription', stopped.id,
        jsonb_build_object(
          'subscription_id', stopped.id,
          'contact_id', stopped.contact_id,
          'plan_id', stopped.plan_id,
          'status', 'withdrawn'
        ));
    end if;

  elsif p_action = 'remove_contact' then
    for stopped in
      update private.email_subscriptions s
      set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
      where s.contact_id = token.contact_id and s.status = 'active'
      returning *
    loop
      perform jobs.emit('communication.subscription_changed', 'subscription', stopped.id,
        jsonb_build_object(
          'subscription_id', stopped.id,
          'contact_id', stopped.contact_id,
          'plan_id', stopped.plan_id,
          'status', 'withdrawn'
        ));
    end loop;

    -- Suppressed first, because that is what writes the tombstone: the
    -- `record_suppression` trigger records the hash in a table nothing deletes
    -- from, and carries the suppression across every other contact holding the
    -- same address. Doing the insert here by hand would be the same rule
    -- written twice.
    update private.email_contacts c
    set status = 'suppressed',
        suppressed_at = now(),
        suppression_reason = 'unsubscribed',
        verified_at = null,
        updated_at = now()
    where c.id = token.contact_id and c.status <> 'suppressed';

    -- And then the address itself goes. "Remove" is what the link says and what
    -- §14 promises — "purges private data" — so leaving the plaintext in
    -- `email_normalized` for ever because the row is merely marked suppressed
    -- would be answering a different request. The tombstone is a hash and
    -- survives; so does the promise it carries, because a contact inserted for
    -- that address later arrives suppressed.
    --
    -- The cascade takes the subscriptions, the tokens — including this one, so
    -- the link stops working, which is the honest state — and any queued email.
    -- Somebody who asked to be forgotten should not receive tomorrow's reminder.
    delete from private.email_contacts c where c.id = token.contact_id;

    removed := true;

  elsif p_action <> 'view' then
    raise exception 'unknown_preference_action' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'removed', removed,
    'subscriptions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'plan_id', s.plan_id,
            'plan_title', p.title,
            'circle_name', ci.name,
            'active', s.status = 'active'
          )
          order by p.window_start desc, s.plan_id
        ),
        '[]'::jsonb
      )
      from private.email_subscriptions s
      join public.plans p on p.id = s.plan_id
      join public.circles ci on ci.id = p.circle_id
      where s.contact_id = token.contact_id
    )
  );
end;
$$;

comment on function public.email_preferences(bytea, text, uuid) is
  'Reads or withdraws one contact''s plan-update subscriptions from a long-lived prefs token, with no sign-in. Removing the contact suppresses the address by hash, permanently. Service role only.';

revoke all on function public.email_preferences(bytea, text, uuid) from public;
revoke all on function public.email_preferences(bytea, text, uuid) from anon, authenticated;
grant execute on function public.email_preferences(bytea, text, uuid) to service_role;

-- supabase/sql/functions/public/issue_reentry_token.sql
-- ---------------------------------------------------------------------------
-- The single-use way back into a circle, for a guest with no session.
--
-- Every event email carries one (spec §5.8, §5.11): "a guest returns with no
-- session" is the most common real thing that happens (§9), and without this
-- their only way back is a link somebody else has to resend. Seven days,
-- single-use, and consumed by `reattach-member` (S1-13), which moves the
-- membership onto whatever identity the browser has now.
--
-- Refused for a saved-place identity, and not by this function: the trigger
-- `enforce_reentry_for_guests` does it, because a re-entry link for somebody
-- who signs in is a sign-in bypass, and that is a rule the table holds rather
-- than one each caller remembers.
--
-- Service role only. It mints nothing itself — the Edge Function generates the
-- token and passes the digest, so the readable form is never a statement
-- parameter and never reaches a query log (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_reentry_token(
  p_circle_id uuid,
  p_user_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_id uuid;
  token_id uuid;
begin
  -- The membership has to be one. A token for a circle this person is not in
  -- would be a link back into somebody else's circle, and the foreign key that
  -- would have caught it raises a SQLSTATE nothing can translate — a 500 for an
  -- ordinary mistake.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  -- The contact this belongs to: a re-entry link travels in an email, so there
  -- is one. Its owner and the membership's owner are the same person, which the
  -- table's own foreign key insists on as well.
  select c.id into contact_id
  from private.email_contacts c
  where c.user_id = p_user_id and c.status = 'verified'
  order by c.verified_at desc
  limit 1;

  if contact_id is null then
    raise exception 'no_verified_contact' using errcode = 'P0001';
  end if;

  insert into private.email_action_tokens (
    contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
  )
  values (contact_id, 'reentry', p_token_hash, now() + interval '7 days', p_circle_id, p_user_id)
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_reentry_token(uuid, uuid, bytea) is
  'Stores the digest of a seven-day single-use re-entry token for a guest membership. The token itself is minted in the Edge Function and never reaches the database. Service role only.';

revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from public;
revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.issue_reentry_token(uuid, uuid, bytea) to service_role;

-- supabase/sql/functions/public/request_email_updates.sql
-- ---------------------------------------------------------------------------
-- "Email me about this meetup."
--
-- Four writes that have to happen together or not at all: the contact, the
-- consent, the verification token, and the job that sends it. A contact with no
-- token is an address stored for nothing; a token with no job is a link nobody
-- receives; a job with no subscription would send an email nobody asked for.
--
-- **One address can belong to two identities.** Uniqueness has been
-- `(email_hash, user_id)` since 0009 — "two guest memberships may each be
-- reachable at the same address (spec §9)" — so this inserts *this person's*
-- contact for the address and says nothing about anybody else's. An earlier
-- draft read the address back by hash alone and refused when the row belonged
-- to somebody else, which turned the commonest real case into a permanent
-- silence: a guest who loses their session, rejoins as a new identity and asks
-- again was told "check your email" and never heard anything.
--
-- **Suppression is not looked up here.** `apply_suppression` gives a new
-- contact for a tombstoned address the status `suppressed` on insert, and
-- `record_suppression` carries a suppression across every contact holding that
-- address. So the honest thing is to insert and read the status back, which is
-- what the note from S1-11 says: "never write `status = 'pending'` over it".
--
-- **It answers the same way whatever happened.** Suppressed, already verified,
-- or new: `sent` says whether an email was enqueued and nothing else, and the
-- endpoint above turns all of them into "check your email". Four different
-- answers would let a member walk a list of addresses through a plan and learn
-- which of their friends use the product.
-- ---------------------------------------------------------------------------

create or replace function public.request_email_updates(
  p_plan_id uuid,
  p_user_id uuid,
  -- Already trimmed, lower-cased and NFC-normalised by the request schema; the
  -- column's own check refuses anything else, so the two agree.
  p_email text,
  p_token_hash bytea,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  contact private.email_contacts;
  subscription private.email_subscriptions;
  token_id uuid;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- A member of the plan's circle, asked of the person the Edge Function
  -- identified rather than of `auth.uid()`: this runs as the service role, so
  -- there is no caller for the database to ask about. The same answer for "no
  -- such plan" and "not your circle", which is what every other read of a plan
  -- does.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Nothing to subscribe to. "Verification after the plan completed or was
  -- cancelled: no stale mail is sent" (spec §9) is the same sentence one step
  -- earlier: asking for email about a meetup that is over would enqueue a
  -- verification message about something that has already happened.
  if plan.state in ('completed', 'cancelled', 'expired') then
    raise exception 'plan_is_finished' using errcode = 'P0001';
  end if;

  -- This person's contact for this address. The insert is where suppression is
  -- decided: `apply_suppression` stamps a tombstoned address as `suppressed`
  -- before the row lands, and an existing row keeps whatever status it has.
  insert into private.email_contacts (user_id, email_normalized)
  values (p_user_id, p_email)
  on conflict (email_hash, user_id) do update set updated_at = now()
  returning * into contact;

  if contact.status = 'suppressed' then
    -- Nothing more is written and nothing is sent. The person asking may not be
    -- the person who suppressed it, and spec §9's "no automatic reactivation"
    -- is the address owner's decision rather than theirs.
    return jsonb_build_object('sent', false);
  end if;

  -- The consent, recorded now with the words it was given for, because now is
  -- when it was given. The subscription is `active` from this moment and the
  -- *contact* is what is unverified: `private.email_recipients_for` sends to a
  -- verified contact with an active subscription and an active membership, and
  -- to nobody else, so an address somebody typed wrong receives nothing while
  -- the row honestly says what was agreed and when (ADR 0019).
  --
  -- Asking again after stopping starts it again — a fresh consent from the
  -- person who owns the address, which is a different thing from the automatic
  -- reactivation of a *suppressed* address that spec §9 forbids.
  insert into private.email_subscriptions (
    contact_id, user_id, scope, plan_id, status, consent_text_version
  )
  values (contact.id, p_user_id, 'plan_updates', p_plan_id, 'active', p_consent_version)
  on conflict (contact_id, scope, plan_id) do update
    set status = 'active',
        withdrawn_at = null,
        consent_text_version = excluded.consent_text_version,
        updated_at = now()
  returning * into subscription;

  perform jobs.emit('communication.subscription_changed', 'subscription', subscription.id,
    jsonb_build_object(
      'subscription_id', subscription.id,
      'contact_id', contact.id,
      'plan_id', p_plan_id,
      'status', subscription.status
    ));

  -- A verified address needs no second verification: the subscription above is
  -- already live, and another link would be an email nobody asked for.
  if contact.status = 'verified' then
    return jsonb_build_object('sent', false);
  end if;

  -- "Resend invalidates the previous token" (spec §5.8). Spent rather than
  -- deleted, so a person clicking the older link is told it is used rather than
  -- that it never existed.
  update private.email_action_tokens t
  set used_at = now()
  where t.contact_id = contact.id and t.purpose = 'verify' and t.used_at is null;

  insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
  values (contact.id, 'verify', p_token_hash, now() + interval '24 hours')
  returning id into token_id;

  insert into jobs.notification_jobs (
    channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
  )
  values (
    'email', 'verify_email', contact.id, p_plan_id, plan.revision, now(),
    -- Architecture §13's key, composed here because the occurrence is the token
    -- this statement just made: a retry of the same request finds the same
    -- token and writes no second email, while a genuine resend mints a new one
    -- and therefore is one.
    jobs.idempotency_key(
      'email', contact.id::text, p_plan_id::text, plan.revision::text,
      'verify_email', token_id::text)
  )
  -- A retry of the same request makes no second email; a genuine resend carries
  -- a new token, and the token's id is the occurrence in the key.
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('sent', true, 'token_id', token_id);
end;
$$;

comment on function public.request_email_updates(uuid, uuid, text, bytea, text) is
  'Records consent to plan-update email for one plan, mints the verification token and enqueues the email. One address may belong to two identities; suppression is decided by the insert trigger. Answers the same way whatever happened. Service role only.';

revoke all on function public.request_email_updates(uuid, uuid, text, bytea, text) from public;
revoke all on function public.request_email_updates(uuid, uuid, text, bytea, text) from anon, authenticated;
grant execute on function public.request_email_updates(uuid, uuid, text, bytea, text) to service_role;

-- supabase/sql/functions/public/verify_email_contact.sql
-- ---------------------------------------------------------------------------
-- The link in the verification email.
--
-- One statement does the consuming, and it has to: `update … where token_hash =
-- $1 and used_at is null and expires_at > now() returning …` is what makes
-- "single use" true when two clicks arrive together. Reading the row and then
-- marking it used is the version with the race in it.
--
-- **Verification is by address, not by row.** Uniqueness has been
-- `(email_hash, user_id)` since 0009, and `private.reconcile_contacts` splits a
-- contact when its identity's memberships are divided — so one person can hold
-- one address on two contacts, one verified and one pending. Verifying only the
-- contact the token names leaves the sibling pending, and retention deletes a
-- pending contact after seven days *with its subscription*: the consent
-- disappears without anybody withdrawing it. Suppression already works this way
-- by hash (`record_suppression`); this is the same reasoning in the other
-- direction.
--
-- What verification changes is the **contact**, not the consent. That was
-- recorded when it was given (ADR 0019), and an unverified contact is what
-- stops mail reaching an address somebody typed wrong.
-- ---------------------------------------------------------------------------

create or replace function public.verify_email_contact(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token private.email_action_tokens;
  contact private.email_contacts;
  live_plans uuid[];
  confirmed_plan uuid;
  confirmation uuid;
  confirmed_revision integer;
begin
  update private.email_action_tokens t
  set used_at = now()
  where t.token_hash = p_token_hash
    and t.purpose = 'verify'
    and t.used_at is null
    and t.expires_at > now()
  returning * into token;

  -- Spent, expired or never ours: one answer for all three. Telling them apart
  -- would say whether a token existed, and what the screen offers is the same
  -- either way — ask for a new link.
  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  select * into contact from private.email_contacts c where c.id = token.contact_id;

  -- A suppressed address stays suppressed. Clicking a link that predates the
  -- bounce is not the address asking to hear from us again (spec §9).
  if contact.status = 'suppressed' then
    return jsonb_build_object('active_plan_ids', '[]'::jsonb, 'already_confirmed', false);
  end if;

  -- Every contact holding this address, not only the one the link named.
  update private.email_contacts c
  set status = 'verified', verified_at = now(), updated_at = now()
  where c.email_hash = contact.email_hash and c.status = 'pending';

  -- The plans that are over take their subscriptions with them, across all of
  -- them: "verification after the plan completed or was cancelled: no stale
  -- mail is sent" (spec §9).
  update private.email_subscriptions s
  set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
  from public.plans p, private.email_contacts c
  where c.email_hash = contact.email_hash
    and s.contact_id = c.id
    and s.status = 'active'
    and p.id = s.plan_id
    and p.state in ('completed', 'cancelled', 'expired');

  -- What this address will now hear about: an active subscription held by a
  -- contact whose owner is still an active member. A removal ends the plan for
  -- them (AGENTS.md: "only active members see or act on it"), and the channel
  -- being email does not change that.
  select coalesce(array_agg(distinct s.plan_id), array[]::uuid[])
  into live_plans
  from private.email_subscriptions s
  join private.email_contacts c on c.id = s.contact_id
  join public.plans p on p.id = s.plan_id
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = c.user_id
  where c.email_hash = contact.email_hash
    and s.status = 'active'
    and m.status = 'active';

  -- The current state, once, for somebody who verified after it was decided.
  select mc.plan_id, mc.id, mc.revision into confirmed_plan, confirmation, confirmed_revision
  from public.meetup_confirmations mc
  where mc.plan_id = any (live_plans) and mc.status = 'active'
  order by mc.confirmed_at desc
  limit 1;

  if confirmation is not null then
    insert into jobs.notification_jobs (
      channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
    )
    values (
      'email', 'locked_in', contact.id, confirmed_plan, confirmed_revision, now(),
      -- Architecture §13's key, composed the one way (`jobs.idempotency_key`),
      -- so that the dispatcher's own `locked_in` for this recipient and this
      -- confirmation *is* this job: verifying late cannot produce a second copy
      -- of an email they have already had.
      jobs.idempotency_key(
        'email', contact.id::text, confirmed_plan::text, confirmed_revision::text,
        'locked_in', confirmation::text)
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- About the contact, not about a plan: this happens once per address, and
  -- which plans it turned out to be subscribed to is a consequence rather than
  -- the fact. The payload is ids, because an address is the one thing that may
  -- never be in one (non-negotiable 8).
  perform jobs.emit('communication.contact_verified', 'contact', contact.id,
    jsonb_build_object('contact_id', contact.id, 'user_id', contact.user_id));

  return jsonb_build_object(
    'active_plan_ids', to_jsonb(live_plans),
    'already_confirmed', confirmation is not null
  );
end;
$$;

comment on function public.verify_email_contact(bytea) is
  'Consumes a verification token in one statement and verifies every contact holding that address, drops subscriptions to finished plans and to circles the person has left, and sends the current state once if a meetup is already locked in. Service role only.';

revoke all on function public.verify_email_contact(bytea) from public;
revoke all on function public.verify_email_contact(bytea) from anon, authenticated;
grant execute on function public.verify_email_contact(bytea) to service_role;

-- END GENERATED: function definitions
