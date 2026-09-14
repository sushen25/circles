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
      and s.status = 'active';

  elsif p_action = 'remove_contact' then
    update private.email_subscriptions s
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where s.contact_id = token.contact_id and s.status = 'active';

    -- Suppressed by the address's own request, which is what `unsubscribed`
    -- means here: recorded by hash in a table nothing deletes from, so the
    -- promise survives the contact row being purged by retention — and so that
    -- somebody re-adding the address later cannot restart the email for them.
    update private.email_contacts c
    set status = 'suppressed',
        suppressed_at = now(),
        suppression_reason = 'unsubscribed',
        updated_at = now()
    where c.id = token.contact_id and c.status <> 'suppressed';

    insert into private.email_suppressions (email_hash, reason)
    select c.email_hash, 'unsubscribed' from private.email_contacts c where c.id = token.contact_id
    on conflict (email_hash) do nothing;

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
-- subscription, the verification token, and the job that sends it. A contact
-- with no token is an address stored for nothing; a token with no job is a link
-- nobody receives; a job with no subscription would send an email the person
-- never asked for.
--
-- **It answers the same way whatever happens.** A suppressed address writes
-- nothing and returns success, because "a suppressed address is resubmitted: no
-- automatic reactivation" (spec §9) and because the alternative tells the
-- caller something about somebody else's address. The same for an address that
-- is already verified by somebody else's request, and for one that has never
-- been seen. The endpoint above turns all of them into "check your email".
--
-- Everything here is `private`, which no client can reach, and the function is
-- `service_role` only: the Edge Function is the door, and the membership check
-- is the lock.
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
  suppressed boolean;
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

  -- The address's own history, by hash, which outlives any contact row: a
  -- person who unsubscribed and later had their account deleted still asked not
  -- to be written to. `email_suppressions` is never deleted from.
  select exists (
    select 1 from private.email_suppressions s
    where s.email_hash = extensions.digest(p_email, 'sha256')
  ) into suppressed;

  if suppressed then
    -- Nothing written, nothing sent, and the same answer as success. The person
    -- asking is not the person who suppressed it.
    return jsonb_build_object('sent', false);
  end if;

  -- One contact per address per person. `email_contacts` is unique on the hash
  -- alone, so an address already held by *somebody else* belongs to them: this
  -- person gets no contact, no subscription and no email, and the same answer.
  -- Otherwise two accounts could both subscribe one address, and the second
  -- would learn the first exists.
  select * into contact from private.email_contacts c
  where c.email_hash = extensions.digest(p_email, 'sha256');

  if found and contact.user_id is distinct from p_user_id then
    return jsonb_build_object('sent', false);
  end if;

  if not found then
    insert into private.email_contacts (user_id, email_normalized)
    values (p_user_id, p_email)
    returning * into contact;
  end if;

  -- The consent, recorded now with the words it was given for, because now is
  -- when it was given. The subscription is `active` from this moment and the
  -- *contact* is what is unverified: `private.email_recipients_for` sends to a
  -- verified contact with an active subscription and to nobody else, so an
  -- address somebody typed wrong receives nothing while the row honestly says
  -- what was agreed and when.
  --
  -- The two statuses this table has are "sending" and "not sending". There is
  -- no third for "asked but unproven", and inventing one by writing `withdrawn`
  -- before anybody withdrew would be a lie in the other direction.
  --
  -- Asking again after stopping starts it again — that is a fresh consent from
  -- the person who owns the address, which is a different thing from the
  -- automatic reactivation of a *suppressed* address that spec §9 forbids.
  insert into private.email_subscriptions (
    contact_id, user_id, scope, plan_id, status, consent_text_version
  )
  values (contact.id, p_user_id, 'plan_updates', p_plan_id, 'active', p_consent_version)
  on conflict (contact_id, scope, plan_id) do update
    set status = 'active',
        withdrawn_at = null,
        consent_text_version = excluded.consent_text_version,
        updated_at = now();

  -- A verified address needs no second verification: the subscription above is
  -- already active, and sending another link would be an email nobody asked
  -- for.
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

  -- One job, keyed so a retry cannot make two. The token's id is the occurrence:
  -- a second request makes a second token and therefore a second email, which is
  -- what "resend" means, while the same request retried makes neither.
  insert into jobs.notification_jobs (
    channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
  )
  values (
    'email', 'verify_email', contact.id, p_plan_id, plan.revision, now(),
    encode(extensions.digest(
      'email' || token_id::text || 'verify_email' || contact.id::text, 'sha256'), 'hex')
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('sent', true);
end;
$$;

comment on function public.request_email_updates(uuid, uuid, text, bytea, text) is
  'Records consent to plan-update email for one plan, mints the verification token and enqueues the email. Answers the same way for a suppressed, taken or unknown address. Service role only.';

revoke all on function public.request_email_updates(uuid, uuid, text, bytea, text) from public;
revoke all on function public.request_email_updates(uuid, uuid, text, bytea, text) from anon, authenticated;
grant execute on function public.request_email_updates(uuid, uuid, text, bytea, text) to service_role;

-- supabase/sql/functions/public/verify_email_contact.sql
-- ---------------------------------------------------------------------------
-- The link in the verification email.
--
-- One statement does the consuming, and it has to: `update … where token_hash
-- = $1 and used_at is null and expires_at > now() returning …` is what makes
-- "single use" true under two clicks arriving together. Reading the row and
-- then marking it used is the version with the race in it.
--
-- What verification changes is the **contact**, not the subscriptions: consent
-- was recorded when it was given, and an unverified contact is what stops mail
-- going to an address somebody typed wrong. So this sets `verified_at` and then
-- withdraws the subscriptions whose plans are over — "verification after the
-- plan completed or was cancelled: no stale mail is sent" (spec §9).
--
-- And if the meetup is already locked in, one `locked_in` email goes out: a
-- person who verifies late should learn the current state once, rather than
-- waiting for the next change to a plan that may not change again.
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

  if contact.status <> 'verified' then
    update private.email_contacts c
    set status = 'verified', verified_at = now(), updated_at = now()
    where c.id = contact.id;
  end if;

  -- The plans that are over take their subscriptions with them.
  update private.email_subscriptions s
  set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
  from public.plans p
  where s.contact_id = contact.id
    and s.status = 'active'
    and p.id = s.plan_id
    and p.state in ('completed', 'cancelled', 'expired');

  select coalesce(array_agg(s.plan_id order by s.plan_id), array[]::uuid[])
  into live_plans
  from private.email_subscriptions s
  where s.contact_id = contact.id and s.status = 'active';

  -- The current state, once, for somebody who verified after it was decided.
  select c.plan_id, c.id into confirmed_plan, confirmation
  from public.meetup_confirmations c
  where c.plan_id = any (live_plans) and c.status = 'active'
  order by c.confirmed_at desc
  limit 1;

  if confirmation is not null then
    insert into jobs.notification_jobs (
      channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
    )
    select 'email', 'locked_in', contact.id, confirmed_plan, p.revision, now(),
      encode(extensions.digest(
        'email' || contact.id::text || 'locked_in' || confirmation::text, 'sha256'), 'hex')
    from public.plans p where p.id = confirmed_plan
    -- Keyed on the confirmation, so the dispatcher's own `locked_in` for this
    -- recipient and this confirmation is the same job: verifying late cannot
    -- produce a second copy of an email they have already had.
    on conflict (idempotency_key) do nothing;
  end if;

  -- About the contact, not about a plan: this happens once per address, and
  -- which plans it turned out to be subscribed to is a consequence rather than
  -- the fact. `aggregate_type = 'contact'` is what the outbox has for it — and
  -- the payload is an id, because an address is the one thing that may never be
  -- in one (non-negotiable 8).
  perform jobs.emit('communication.contact_verified', 'contact', contact.id, '{}'::jsonb);

  return jsonb_build_object(
    'active_plan_ids', to_jsonb(live_plans),
    'already_confirmed', confirmation is not null
  );
end;
$$;

comment on function public.verify_email_contact(bytea) is
  'Consumes a verification token in one statement, verifies the contact, drops subscriptions to finished plans and sends the current state once if a meetup is already locked in. Service role only.';

revoke all on function public.verify_email_contact(bytea) from public;
revoke all on function public.verify_email_contact(bytea) from anon, authenticated;
grant execute on function public.verify_email_contact(bytea) to service_role;

-- END GENERATED: function definitions
