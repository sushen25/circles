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
