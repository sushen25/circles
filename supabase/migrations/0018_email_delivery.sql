-- ---------------------------------------------------------------------------
-- 0018 — sending email, and hearing back about it (S1-19).
--
-- No new tables: `email_delivery_events`, `email_action_tokens` and
-- `email_suppressions` have been in `private` since 0006. What was missing was
-- the functions the sender and the provider's webhook call:
--
--   `public.issue_preferences_token`  the footer link, minted with each email
--   `public.issue_reentry_token`      now for a contact, not a user
--   `public.record_email_delivery`    store a delivery event once; a hard
--                                     bounce or a complaint suppresses the
--                                     address
--
-- `issue_reentry_token` keeps its argument types and changes what the second
-- one means — the recipient's contact rather than its owner — so it is dropped
-- first: `create or replace` cannot rename a parameter, and a replace that
-- could would leave a caller passing a user id with no error to tell it.
--
-- The definitions are in `supabase/sql/functions/` (ADR 0015); this migration
-- only carries them. A new migration rather than a regenerated `0017`, because
-- `0017` has shipped.
-- ---------------------------------------------------------------------------

drop function if exists public.issue_reentry_token(uuid, uuid, bytea);

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/issue_preferences_token.sql
-- ---------------------------------------------------------------------------
-- The link under every plan-update email, minted when the email is sent.
--
-- "Stop emails for this meetup" and "Manage email preferences" both open
-- `/e#<token>` (ADR 0023), and the token behind them is minted here by the
-- sender for the one letter it is going into — the rule ADR 0020 set for the
-- verification token, and for the same reason: a job row carries ids and no
-- payload, so a token minted anywhere earlier has no way to reach the letter.
--
-- **One per email, reusable, ninety days** (ADR 0019): tapping it does not
-- spend it, because an unsubscribe that worked once and then broke would not
-- be one. ADR 00XX records why it is one per email rather than one per contact:
-- the readable token is never stored, so an existing one cannot be put into a
-- second letter. Retention removes each a week after it expires.
--
-- **Null is an ordinary answer**, as it is for `issue_verification_token`: a
-- contact that is not verified — suppressed by a bounce since the job was
-- queued, or removed by its owner — is not somebody the dispatcher should be
-- mailing, and the job is skipped rather than retried. The dispatcher's own
-- eligibility read (`private.email_recipients_for`) should already have said
-- so; this is the second place that refuses, not the first.
--
-- Service role only. The Edge Function mints the token and passes the digest,
-- so the readable form is never a statement parameter (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_preferences_token(
  p_contact_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_id uuid;
begin
  if not exists (
    select 1 from private.email_contacts c where c.id = p_contact_id and c.status = 'verified'
  ) then
    return null;
  end if;

  insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
  values (p_contact_id, 'prefs', p_token_hash, now() + interval '90 days')
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_preferences_token(uuid, bytea) is
  'Stores the digest of a ninety-day reusable preferences token for one verified contact, for the email being sent. Null when the contact is not verified, which the sender treats as a skipped job. The token itself is minted in the Edge Function. Service role only.';

revoke all on function public.issue_preferences_token(uuid, bytea) from public;
revoke all on function public.issue_preferences_token(uuid, bytea) from anon, authenticated;
grant execute on function public.issue_preferences_token(uuid, bytea) to service_role;

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
-- **Null for a saved-place identity**, because that is not a fault. Every event
-- email carries a re-entry link and permanent members get event email too; the
-- template simply leaves the link out for somebody who can sign in. Reaching
-- the table's own guard instead — `enforce_reentry_for_guests`, which raises
-- `check_violation` — turned an ordinary rendering decision into a SQLSTATE
-- nothing can translate and a 500 for the reader. The trigger stays: it is the
-- rule, and this is the answer the one caller needs. A sign-in bypass is still
-- impossible, now twice over.
--
-- **For the contact the letter is going to** (S1-19). It used to take the
-- user and hang the token on their most recently verified contact, which is
-- not necessarily the address the email is for: somebody with two verified
-- addresses who later removed the first had the cascade take the re-entry
-- links out of letters sent to the second. The dispatcher knows exactly which
-- contact it is writing to — the job names it — so it says so, and the user is
-- the contact's owner.
--
-- Service role only. It mints nothing itself — the Edge Function generates the
-- token and passes the digest, so the readable form is never a statement
-- parameter and never reaches a query log (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_reentry_token(
  p_circle_id uuid,
  p_contact_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact private.email_contacts;
  token_id uuid;
begin
  -- A verified one: a re-entry link travels in an email, and an email goes
  -- only to an address that proved itself.
  select * into contact from private.email_contacts c where c.id = p_contact_id;

  if not found or contact.status <> 'verified' then
    raise exception 'no_verified_contact' using errcode = 'P0001';
  end if;

  -- Somebody who signs in needs no way back, so there is nothing to issue and
  -- nothing has gone wrong. Checked before the membership, because a permanent
  -- identity's membership is beside the point.
  if exists (
    select 1 from public.profiles pr where pr.user_id = contact.user_id and pr.is_permanent
  ) then
    return null;
  end if;

  -- The membership has to be one. A token for a circle this person is not in
  -- would be a link back into somebody else's circle, and the foreign key that
  -- would have caught it raises a SQLSTATE nothing can translate — a 500 for an
  -- ordinary mistake.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = contact.user_id and m.status = 'active'
  ) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  insert into private.email_action_tokens (
    contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
  )
  values (
    contact.id, 'reentry', p_token_hash, now() + interval '7 days', p_circle_id, contact.user_id
  )
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_reentry_token(uuid, uuid, bytea) is
  'Stores the digest of a seven-day single-use re-entry token for the guest membership of one verified contact''s owner, and returns null for a saved-place identity, which needs no link. The token itself is minted in the Edge Function and never reaches the database. Service role only.';

revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from public;
revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.issue_reentry_token(uuid, uuid, bytea) to service_role;

-- supabase/sql/functions/public/record_email_delivery.sql
-- ---------------------------------------------------------------------------
-- What the provider said about one message, and what follows from it.
--
-- Called by `email-provider-webhook` once the provider's signature has been
-- checked (architecture §13: "verify Svix signature; bounced/complained →
-- suppress contact immediately; store event once"). Everything here happens in
-- one transaction, so a webhook that fails half-way is retried whole rather
-- than leaving an event stored and its suppression undone.
--
-- **Stored once.** `(provider_message_id, event_type)` is unique, and a second
-- delivery of the same event — the provider retries until it sees a 2xx, and
-- a replayed request is the same event again — inserts nothing and does
-- nothing else. `recorded` says which it was.
--
-- **A hard bounce or a complaint suppresses the address, not the contact.**
-- Suppression is by `email_hash` everywhere else (0009, `email_preferences`),
-- and here too: every contact holding the address is suppressed — the
-- `record_suppression` trigger writes the tombstone and reaches the siblings —
-- every subscription at the address is withdrawn with an event of its own, and
-- every email still queued for it is skipped. The address comes from the
-- webhook's own `to`, hashed by the caller, so a bounce for a message whose
-- job has already been pruned (thirty days) still lands; the job's contact is
-- the fallback. When no contact holds the address any more the tombstone is
-- written directly, so it cannot be added back later and mailed again.
--
-- A soft bounce (`p_permanent` false) is stored and changes nothing: Resend
-- reports a transient failure as a bounce with `type: Transient`, and
-- suppressing somebody for a full mailbox would be permanent punishment for a
-- temporary state.
--
-- Returns ids only — the contact, the plan and its circle, for the caller's
-- log line and analytics event. Never the address.
-- ---------------------------------------------------------------------------

create or replace function public.record_email_delivery(
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_permanent boolean default true,
  p_email_hash bytea default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job jobs.notification_jobs;
  event_id uuid;
  target bytea;
  reason text;
  suppressed boolean := false;
  stopped private.email_subscriptions;
begin
  if p_event_type not in ('sent', 'delivered', 'bounced', 'complained', 'deferred', 'failed') then
    raise exception 'unknown_delivery_event' using errcode = 'P0001';
  end if;

  -- The job this message was sent for, when the dispatcher has recorded it.
  select * into job
  from jobs.notification_jobs j
  where j.provider_message_id = p_provider_message_id and j.channel = 'email'
  order by j.created_at desc
  limit 1;

  insert into private.email_delivery_events (
    job_id, provider_message_id, event_type, provider_occurred_at
  )
  values (job.id, p_provider_message_id, p_event_type, p_occurred_at)
  on conflict (provider_message_id, event_type) do nothing
  returning id into event_id;

  if event_id is null then
    -- Already stored: a retry or a replay. Whatever it caused has happened.
    return jsonb_build_object(
      'recorded', false,
      'suppressed', false,
      'contact_id', job.contact_id,
      'plan_id', job.plan_id,
      'circle_id', (select p.circle_id from public.plans p where p.id = job.plan_id)
    );
  end if;

  if p_event_type = 'complained' or (p_event_type = 'bounced' and p_permanent) then
    reason := case p_event_type when 'complained' then 'complained' else 'bounced' end;
    target := coalesce(
      p_email_hash,
      (select c.email_hash from private.email_contacts c where c.id = job.contact_id)
    );

    if target is not null then
      for stopped in
        update private.email_subscriptions s
        set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
        from private.email_contacts c
        where c.id = s.contact_id and c.email_hash = target and s.status = 'active'
        returning s.*
      loop
        perform jobs.emit('communication.subscription_changed', 'subscription', stopped.id,
          jsonb_build_object(
            'subscription_id', stopped.id,
            'contact_id', stopped.contact_id,
            'plan_id', stopped.plan_id,
            'status', 'withdrawn'
          ));
      end loop;

      update jobs.notification_jobs j
      set status = 'skipped', last_error = 'suppressed', updated_at = now()
      from private.email_contacts c
      where c.id = j.contact_id and c.email_hash = target
        and j.channel = 'email' and j.status = 'scheduled';

      update private.email_contacts c
      set status = 'suppressed',
          suppressed_at = coalesce(p_occurred_at, now()),
          suppression_reason = reason,
          verified_at = null,
          updated_at = now()
      where c.email_hash = target and c.status <> 'suppressed';

      -- The trigger above wrote this if any contact changed. If none did — the
      -- address has no contact left, or every one was already suppressed for
      -- another reason — the address is still one that bounced.
      insert into private.email_suppressions (email_hash, reason, suppressed_at)
      values (target, reason, coalesce(p_occurred_at, now()))
      on conflict (email_hash) do nothing;

      suppressed := true;
    end if;
  end if;

  perform jobs.emit('communication.delivery_recorded', 'delivery', event_id,
    jsonb_build_object(
      'delivery_id', event_id,
      'job_id', job.id,
      'contact_id', job.contact_id,
      'event_type', p_event_type,
      'suppressed', suppressed
    ));

  return jsonb_build_object(
    'recorded', true,
    'suppressed', suppressed,
    'contact_id', job.contact_id,
    'plan_id', job.plan_id,
    'circle_id', (select p.circle_id from public.plans p where p.id = job.plan_id)
  );
end;
$$;

comment on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) is
  'Stores one provider delivery event once, and on a hard bounce or a complaint suppresses the address, withdraws its subscriptions and skips its queued email, in one transaction. Returns ids only. Service role only; the webhook that calls it has verified the provider signature.';

revoke all on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) from public;
revoke all on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) from anon, authenticated;
grant execute on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) to service_role;

-- END GENERATED: function definitions
