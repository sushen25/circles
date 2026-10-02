-- ---------------------------------------------------------------------------
-- 0034 — Verifying an address promotes only the same person's contacts
-- (SUS-106, ADR 0049).
--
-- `public.verify_email_contact` marked every pending contact at an address
-- verified, whoever held it. It now promotes, withdraws finished-plan
-- subscriptions for, and queues "locked in" mail for the contacts of one person
-- only: the same `user_id`, or an identity linked to it by a recorded
-- reattachment (`private.same_person_identities`, new). Another identity's
-- pending contact stays pending and retention removes it as before.
--
-- No table changes.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/private/same_person_identities.sql
-- ---------------------------------------------------------------------------
-- The identities that count as one person for verifying an address
-- (ADR 0049).
--
-- Verifying an address proves that whoever held the link controls it. It says
-- nothing about another identity's consent, so promotion stops at "the same
-- person": the identity itself, and the identities that **one membership's
-- history of reattachments** connects it to. `reattach_member` records both ids
-- and the circle in `private.audit_log` (`circles.member_reattached`, written in
-- the move's own transaction), and `reconcile_contacts` is what leaves one
-- person holding one address on two contacts, on either side of a move. A
-- membership moved twice (A to B, then B to C) carries a contact it already
-- copied to C, with the verification link still on A, so the walk follows the
-- whole chain rather than one hop.
--
-- **One membership, not one identity.** An identity can hold a membership of a
-- circle, pass it on, and later take somebody else's place in the same circle;
-- connecting rows through the identity would make those two people one. So two
-- rows are joined only when they are consecutive for the identity between them:
-- one move *to* it, and the next thing that happens to it in that circle is a
-- move *from* it. If another move touches it first (a different place arriving,
-- or leaving), the first membership ended some other way and the chain stops.
-- Rows are ordered by `occurred_at`, the transaction's time: one
-- `reattach_member` call is one transaction, so two moves never tie.
--
-- Within one circle, and no further: an identity that takes places in two
-- circles would otherwise connect the people it took them from, who have
-- nothing to do with each other. Nothing else makes two identities one person:
-- not the same address, circle or time. A claim (`claim_identity`) is not a row
-- here and needs none: it moves or merges the guest's contacts into the saved
-- place's own, so nothing of the person is left behind to link to.
-- ---------------------------------------------------------------------------

create or replace function private.same_person_identities(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive m as (
    select a.id, a.resource_id as circle_id, a.occurred_at as at,
           a.metadata ->> 'from_user_id' as from_id, a.metadata ->> 'to_user_id' as to_id
    from private.audit_log a
    where a.action = 'circles.member_reattached'
  ),
  -- Row r moved a membership to an identity, and row s is the very next thing
  -- that happened to that identity in the circle: the same membership moving on.
  link as (
    select r.id as first_id, s.id as next_id
    from m r
    join m s on s.circle_id = r.circle_id and s.from_id = r.to_id and s.at > r.at
    where not exists (
      select 1 from m q
      where q.circle_id = r.circle_id
        and q.id not in (r.id, s.id)
        and r.to_id in (q.from_id, q.to_id)
        and q.at > r.at and q.at < s.at
    )
  ),
  walk (id) as (
    select m.id from m where p_user_id::text in (m.from_id, m.to_id)
    union
    select case when l.first_id = w.id then l.next_id else l.first_id end
    from walk w
    join link l on w.id in (l.first_id, l.next_id)
  )
  select p_user_id
  union
  select m.from_id::uuid from m join walk w on w.id = m.id
  union
  select m.to_id::uuid from m join walk w on w.id = m.id
$$;

comment on function private.same_person_identities(uuid) is
  'An identity and the identities connected to it by the recorded reattachments of one circle''s membership: the set whose pending contacts verifying an address may promote (ADR 0049).';

revoke all on function private.same_person_identities(uuid) from public;
revoke all on function private.same_person_identities(uuid) from anon, authenticated;
grant execute on function private.same_person_identities(uuid) to service_role;

-- supabase/sql/functions/public/verify_email_contact.sql
-- ---------------------------------------------------------------------------
-- The link in the verification email.
--
-- One statement does the consuming, and it has to: `update … where token_hash =
-- $1 and used_at is null and expires_at > now() returning …` is what makes
-- "single use" true when two clicks arrive together. Reading the row and then
-- marking it used is the version with the race in it.
--
-- **Verification is by address and by person, not by row.** Uniqueness has been
-- `(email_hash, user_id)` since 0009, and `private.reconcile_contacts` splits a
-- contact when its identity's memberships are divided — so one person can hold
-- one address on two contacts, one verified and one pending. Verifying only the
-- contact the token names leaves the sibling pending, and retention deletes a
-- pending contact after seven days *with its subscription*: the consent
-- disappears without anybody withdrawing it. Suppression already works this way
-- by hash (`record_suppression`); this is the same reasoning in the other
-- direction.
--
-- **"Not by row" stops at the person (ADR 0049).** What is proved is that the
-- holder of the link controls the address, which says nothing about another
-- identity's consent to a plan. So the contacts this touches — promoted, stopped
-- for a finished plan, owed a "locked in" letter — are the ones held by the same
-- `user_id` or by an identity linked to it by a recorded reattachment
-- (`private.same_person_identities`). Another identity's pending contact at the
-- address stays pending, and retention removes it as it always has.
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
  own jsonb;
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
    return jsonb_build_object('active_plans', '[]'::jsonb, 'already_confirmed', false);
  end if;

  -- Every contact of this person holding this address, not only the one the
  -- link named, and nobody else's.
  update private.email_contacts c
  set status = 'verified', verified_at = now(), updated_at = now()
  where c.email_hash = contact.email_hash
    and c.status = 'pending'
    and c.user_id in (select private.same_person_identities(contact.user_id));

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
      and c.user_id in (select private.same_person_identities(contact.user_id))
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
  -- Named, not numbered. This page is opened wherever the mail was read, so
  -- the browser usually holds no session and often a brand-new anonymous one —
  -- and `plans_select_member` means a non-member resolves none of these ids to
  -- anything. Returning bare uuids left the screen with nothing to put on the
  -- button and nowhere to send it (`/p/` takes a short code).
  --
  -- The same two facts `email_preferences` already returns, for the same
  -- reason, and safe for the same reason: whoever holds this token proved
  -- control of the address, and the email that carried it named the plan and
  -- the circle to this reader already. Nothing else comes with them — no member
  -- names, no addresses, no quiet-ask state (§5.8).
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'plan_id', x.plan_id,
          'short_code', x.short_code,
          'plan_title', x.plan_title,
          'circle_name', x.circle_name
        )
        order by x.plan_title, x.plan_id
      ),
      '[]'::jsonb
    ),
    coalesce(array_agg(x.plan_id), array[]::uuid[])
  into own, own_plans
  from (
    select distinct p.id as plan_id, p.short_code, p.title as plan_title, ci.name as circle_name
    from private.email_subscriptions s
    join public.plans p on p.id = s.plan_id
    join public.circles ci on ci.id = p.circle_id
    join public.circle_members m on m.circle_id = p.circle_id and m.user_id = contact.user_id
    where s.contact_id = contact.id
      and s.status = 'active'
      and m.status = 'active'
  ) x;

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
      and c.user_id in (select private.same_person_identities(contact.user_id))
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
    'active_plans', own,
    'already_confirmed', already_confirmed
  );
end;
$$;

comment on function public.verify_email_contact(bytea) is
  'Consumes a verification token in one statement and verifies every pending contact of the same person (the same identity, or one linked by a recorded reattachment) holding that address, and no other identity''s (ADR 0049), drops subscriptions to finished plans, and queues the current state for each decided plan against the contact that subscribed to it. Answers with the clicking identity''s own plans, named so an unauthenticated page can read them. Service role only.';

revoke all on function public.verify_email_contact(bytea) from public;
revoke all on function public.verify_email_contact(bytea) from anon, authenticated;
grant execute on function public.verify_email_contact(bytea) to service_role;

-- END GENERATED: function definitions
