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
  own_plans uuid[];
  stopped private.email_subscriptions;
  decided record;
  already_confirmed boolean;
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
  --
  -- Row by row, because each one is a consent ending and a consent that ends
  -- without an event is a consent that stops for reasons nothing downstream can
  -- see. `email_preferences` says the same thing the same way; a withdrawal
  -- that emits in one function and not in the other is one rule written twice,
  -- differently.
  for stopped in
    update private.email_subscriptions s
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    from public.plans p, private.email_contacts c
    where c.email_hash = contact.email_hash
      and s.contact_id = c.id
      and s.status = 'active'
      and p.id = s.plan_id
      and p.state in ('completed', 'cancelled', 'expired')
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

  -- What *this* identity will now hear about: an active subscription of their
  -- own, on a plan whose circle they are still in. A removal ends the plan for
  -- them (AGENTS.md: "only active members see or act on it"), and the channel
  -- being email does not change that.
  --
  -- Their own, and not the address's: verification crosses the siblings because
  -- the address is what is being proved, but the *answer* goes to one browser
  -- held by one identity, and the plans another identity is subscribed to are
  -- not theirs to be told about. Spec §9: memberships are not revealed to each
  -- other, and two guests at one mailbox are still two people.
  select coalesce(array_agg(distinct s.plan_id), array[]::uuid[])
  into own_plans
  from private.email_subscriptions s
  join public.plans p on p.id = s.plan_id
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = contact.user_id
  where s.contact_id = contact.id
    and s.status = 'active'
    and m.status = 'active';

  -- The current state, once, for somebody who verified after it was decided —
  -- and once *per subscription*, against the contact that holds it.
  --
  -- The recipient is the subscription's contact, never the one the link named.
  -- Writing `contact.id` for a sibling's plan produced a job for somebody who
  -- is not in that circle: `email_recipients_for` names a different contact, so
  -- a drain racing this verification sends the same letter twice; the re-entry
  -- link the template needs raises `not_a_member`; and the "stop this meetup"
  -- link in it is scoped to a subscription that does not exist. One row per
  -- (contact, confirmed plan), for the same reason `live_plans` was a set: an
  -- address subscribed to two decided plans is owed both.
  already_confirmed := false;

  for decided in
    select s.contact_id, s.plan_id, mc.id as confirmation_id, mc.revision
    from private.email_subscriptions s
    join private.email_contacts c on c.id = s.contact_id
    join public.plans p on p.id = s.plan_id
    join public.circle_members m on m.circle_id = p.circle_id and m.user_id = c.user_id
    join public.meetup_confirmations mc on mc.plan_id = p.id and mc.status = 'active'
    where c.email_hash = contact.email_hash
      and s.status = 'active'
      and m.status = 'active'
  loop
    insert into jobs.notification_jobs (
      channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
    )
    values (
      'email', 'locked_in', decided.contact_id, decided.plan_id, decided.revision, now(),
      -- Architecture §13's key, composed the one way (`jobs.idempotency_key`),
      -- so that the dispatcher's own `locked_in` for this recipient and this
      -- confirmation *is* this job: verifying late cannot produce a second copy
      -- of an email they have already had.
      jobs.idempotency_key(
        'email', decided.contact_id::text, decided.plan_id::text, decided.revision::text,
        'locked_in', decided.confirmation_id::text)
    )
    on conflict (idempotency_key) do nothing;

    if decided.plan_id = any (own_plans) then
      already_confirmed := true;
    end if;
  end loop;

  -- About the contact, not about a plan: this happens once per address, and
  -- which plans it turned out to be subscribed to is a consequence rather than
  -- the fact. The payload is ids, because an address is the one thing that may
  -- never be in one (non-negotiable 8).
  perform jobs.emit('communication.contact_verified', 'contact', contact.id,
    jsonb_build_object('contact_id', contact.id, 'user_id', contact.user_id));

  return jsonb_build_object(
    'active_plan_ids', to_jsonb(own_plans),
    'already_confirmed', already_confirmed
  );
end;
$$;

comment on function public.verify_email_contact(bytea) is
  'Consumes a verification token in one statement and verifies every contact holding that address, drops subscriptions to finished plans, and queues the current state for each decided plan against the contact that subscribed to it. Answers with the clicking identity''s own plans only. Service role only.';

revoke all on function public.verify_email_contact(bytea) from public;
revoke all on function public.verify_email_contact(bytea) from anon, authenticated;
grant execute on function public.verify_email_contact(bytea) to service_role;
