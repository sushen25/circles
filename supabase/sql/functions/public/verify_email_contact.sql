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
