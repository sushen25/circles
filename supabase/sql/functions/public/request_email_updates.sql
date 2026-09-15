-- ---------------------------------------------------------------------------
-- "Email me about this meetup."
--
-- Three writes that have to happen together or not at all: the contact, the
-- consent, and the job that sends the verification email. A contact with no job
-- is an address stored for nothing; a job with no subscription would send an
-- email nobody asked for.
--
-- **The token is not one of them.** It is minted when the email is sent, by
-- whoever sends it (ADR 0020) — a token minted here has no way of reaching the
-- letter: `jobs.notification_jobs` carries ids and no payload, the outbox
-- refuses any key named `token`, and the row in `email_action_tokens` holds
-- only a digest. An earlier draft took `p_token_hash`, wrote the row, and threw
-- the readable half away in the Edge Function, which made every verification
-- link unsendable and every token row expire unused.
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
  p_consent_version text,
  -- The request this is, which is what architecture §13 calls the occurrence
  -- for `verify_email`: a retry never reaches this function (the idempotency
  -- claim answers it), and a genuine resend is a new request and so a new
  -- email. Not a token id any more, because there is no token here to name.
  p_request_id text
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

  insert into jobs.notification_jobs (
    channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
  )
  values (
    'email', 'verify_email', contact.id, p_plan_id, plan.revision, now(),
    -- Architecture §13's key, composed the one way (`jobs.idempotency_key`).
    -- The dispatcher will mint the token for this job when it sends it and
    -- spend whatever came before (`public.issue_verification_token`), which is
    -- where "resend invalidates the previous token" (spec §5.8) now lives:
    -- one job, one letter, one live link.
    jobs.idempotency_key(
      'email', contact.id::text, p_plan_id::text, plan.revision::text,
      'verify_email', p_request_id)
  )
  -- Belt and braces behind the idempotency claim in the Edge Function, which is
  -- what actually answers a retry: the same request id twice is the same key,
  -- and the second insert is the no-op it should be.
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('sent', true);
end;
$$;

comment on function public.request_email_updates(uuid, uuid, text, text, text) is
  'Records consent to plan-update email for one plan and enqueues the verification email; the token is minted by the sender (ADR 0020). One address may belong to two identities; suppression is decided by the insert trigger. Answers the same way whatever happened. Service role only.';

revoke all on function public.request_email_updates(uuid, uuid, text, text, text) from public;
revoke all on function public.request_email_updates(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function public.request_email_updates(uuid, uuid, text, text, text) to service_role;
