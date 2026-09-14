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
