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
-- history of reattachments and claims** connects it to. `reattach_member` and
-- `claim_identity` record both ids and the circle in `private.audit_log`
-- (`circles.member_reattached`, `circles.member_claimed`, written in the move's
-- own transaction), and `reconcile_contacts` is what leaves one
-- person holding one address on two contacts, on either side of a move. A
-- membership moved twice (A to B, then B to C) carries a contact it already
-- copied to C, with the verification link still on A, so the walk follows the
-- whole chain rather than one hop.
--
-- **One membership, not one identity.** An identity can hold a membership of a
-- circle, pass it on, and later take somebody else's place in the same circle;
-- connecting rows through the identity would make those two people one. So two
-- rows are joined only when they are consecutive for the identity between them:
-- one move *to* it, and the next recorded move that touches it in that circle is
-- a move *from* it. If another recorded move touches it first (a different place
-- arriving, or leaving) or the owner removes it (`circles.member_removed`), the
-- chain stops. Rows are ordered by `occurred_at`, the transaction's
-- time: one call is one transaction, so two moves of one circle never tie; two
-- calls racing on one circle's lock can commit in the opposite order to their
-- start (ADR 0049, residuals).
--
-- Within one circle, and no further: an identity that takes places in two
-- circles would otherwise connect the people it took them from, who have
-- nothing to do with each other. Nothing else makes two identities one person:
-- not the same address, circle or time. A claim is recorded
-- for each circle it moves, because a split leaves the verification link on the
-- guest and the copy on the saved place.
-- ---------------------------------------------------------------------------

create or replace function private.same_person_identities(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive m as (
    -- Every recorded event in this circle that touches a place held by an
    -- identity: a move (both ids) or an owner's removal (`from_id` only).
    select a.id, a.resource_id as circle_id, a.occurred_at as at,
           coalesce(a.metadata ->> 'from_user_id', a.metadata ->> 'user_id') as from_id,
           a.metadata ->> 'to_user_id' as to_id
    from private.audit_log a
    where a.action in ('circles.member_reattached', 'circles.member_claimed',
                       'circles.member_removed')
      -- Only the circles this identity appears in: the walk never leaves them,
      -- and one busy circle elsewhere should not slow every verification.
      and a.resource_id in (
        select x.resource_id from private.audit_log x
        where x.action in ('circles.member_reattached', 'circles.member_claimed')
          and p_user_id::text in (x.metadata ->> 'from_user_id', x.metadata ->> 'to_user_id')
      )
  ),
  -- Row r moved a membership to an identity, and row s is the very next thing
  -- that happened to that identity in the circle, and is a move: the same
  -- membership moving on. A removal in between ends the membership.
  link as (
    select r.id as first_id, s.id as next_id
    from m r
    join m s on s.circle_id = r.circle_id and s.from_id = r.to_id and s.at > r.at
    where r.to_id is not null and s.to_id is not null
      and not exists (
        select 1 from m q
        where q.circle_id = r.circle_id
          and q.id not in (r.id, s.id)
          and r.to_id in (q.from_id, q.to_id)
          and q.at > r.at and q.at < s.at
      )
  ),
  walk (id) as (
    select m.id from m where m.to_id is not null and p_user_id::text in (m.from_id, m.to_id)
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
  'An identity and the identities connected to it by the recorded moves (reattachment or claim) of one circle''s membership, ended by an owner''s removal: the set whose pending contacts verifying an address may promote (ADR 0049).';

revoke all on function private.same_person_identities(uuid) from public;
revoke all on function private.same_person_identities(uuid) from anon, authenticated;
grant execute on function private.same_person_identities(uuid) to service_role;

-- supabase/sql/functions/public/claim_identity.sql
-- ---------------------------------------------------------------------------
-- claim_identity
--
-- Somebody saves their place (§10): `linkIdentity` with an email code, or
-- `signInWithIdToken` with Apple or Google, on top of the anonymous session
-- they have been using as a guest. Two different things can have just happened,
-- and the client cannot tell them apart on its own:
--
--   * the identity was new, so Supabase attached it to the anonymous user —
--     same user id, `is_anonymous` now false, nothing to merge; or
--   * the identity already existed, so Supabase signed them in *as that user*
--     and the anonymous one is now abandoned along with its memberships.
--
-- The second is the case §10 means by "`claim-identity` to reconcile
-- memberships if the permanent identity already existed".
--
-- **Granted to `service_role` and nothing else.** This is the one function of
-- the three whose authorisation cannot live in SQL: the claim being made is "I
-- was also this anonymous user", and the only proof of it is that session's
-- access token, which the caller no longer holds as `auth.uid()`. The Edge
-- Function verifies that token and then calls this. Were it callable by
-- `authenticated`, `p_anonymous_user_id` would be an unchecked parameter naming
-- somebody else's guest membership — which is to say, a way to take it. A
-- definer function granted to a client role must never take the identity it
-- acts on as an argument; this one takes two, so it is not granted to one.
--
-- Idempotent. Saying it twice moves nothing the first call did not move, and
-- the audit row keeps `growth.account_claimed` from being counted twice.
-- ---------------------------------------------------------------------------

create or replace function public.claim_identity(
  p_user_id uuid,
  p_anonymous_user_id uuid,
  p_moment text
)
returns table (merged_memberships integer, duplicates_removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  merged integer := 0;
  -- Counted separately because the client has an analytics event for it —
  -- `duplicate_member_removed` in `packages/contracts/analytics.ts` — and nothing
  -- could produce it: the row's removal emits the ordinary
  -- `circles.member_removed`, which says nothing about *why*. Only this function
  -- knows, so only this function can report it.
  removed integer := 0;
  membership record;
begin
  if p_user_id is null or p_anonymous_user_id is null then
    raise exception 'claim_identity needs both identities'
      using errcode = 'null_value_not_allowed';
  end if;

  -- The moment is an enum in `packages/contracts/analytics.ts`, and the event
  -- this writes is validated against that catalogue downstream. Refusing here
  -- turns a payload the pipeline would drop into an error the caller can see.
  if p_moment is null or p_moment not in
    ('after_answer', 'after_attendance', 'after_confirmed', 'organiser_gate', 'reattached',
     'settings') then
    raise exception 'claim_identity got an unknown moment'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A saved place is what is being claimed, so the destination must have one.
  -- Without this check an anonymous caller could have its own profile marked
  -- permanent — which takes it off every Continue-as list and makes its
  -- membership unreattachable, locking somebody out of their own way back in
  -- without a sign-in anywhere in the story. Read from `auth.users`, which only
  -- the auth server writes.
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and not coalesce(u.is_anonymous, true)
  ) then
    raise exception 'destination_is_not_permanent' using errcode = 'insufficient_privilege';
  end if;

  -- The durable record of the saved place. `handle_user_updated` sets this when
  -- the auth row stops being anonymous, which covers the `linkIdentity` case;
  -- this covers the other one, where the permanent user existed already and its
  -- profile may predate the column.
  update public.profiles p set is_permanent = true
  where p.user_id = p_user_id and not p.is_permanent;

  if p_anonymous_user_id <> p_user_id then
    -- Never merge *from* a saved place. Both identities belonging to one person
    -- is the premise; two saved places is two accounts, and moving memberships
    -- between them on a client's word would be a way to take one. The anonymous
    -- side has nothing to lose and no sign-in to bypass, which is exactly why it
    -- is the only side this accepts.
    if exists (
      select 1 from auth.users u
      where u.id = p_anonymous_user_id and not coalesce(u.is_anonymous, false)
    ) or exists (
      select 1 from public.profiles p
      where p.user_id = p_anonymous_user_id and p.is_permanent
    ) then
      raise exception 'source_is_permanent' using errcode = 'insufficient_privilege';
    end if;

    for membership in
      select m.circle_id
      from public.circle_members m
      where m.user_id = p_anonymous_user_id and m.status = 'active'
      -- Locked in a fixed order: two claims racing for one pair of identities
      -- would otherwise deadlock against each other half way through.
      order by m.circle_id
      for update
    loop
      if exists (
        select 1 from public.circle_members m
        where m.circle_id = membership.circle_id and m.user_id = p_user_id
          and m.status = 'active'
      ) then
        -- Both identities are *active* in this circle: one person who joined
        -- twice, from two devices, under two names (spec §9). The saved place is
        -- the one that keeps working, so it stays and the guest row goes.
        --
        -- Everything the survivor does not already have is adopted first.
        -- `on_member_removed` deletes or neutralises what is left on the removed
        -- membership (spec §4.5), and an answer this person gave is not a thing to
        -- delete because they signed in. `private.adopt_membership_rows` holds the
        -- list, so it is one list with `move_membership` rather than a handful of
        -- updates written out here and forgotten about separately.
        perform private.adopt_membership_rows(
          membership.circle_id, p_anonymous_user_id, p_user_id
        );

        update public.circle_members m
        set status = 'removed'
        where m.circle_id = membership.circle_id and m.user_id = p_anonymous_user_id;
        removed := removed + 1;

        -- The retired identity stays, and so does this `removed` row. That is not
        -- the reattachment story — there the membership *leaves* the old identity,
        -- which then has none and is swept by `run_retention` after thirty days
        -- (ADR 0014: "a guest session that never joined anything"). This identity
        -- joined something, so it is not abandoned by that definition and the sweep
        -- will not take it.
        --
        -- Which is right, and is what happens to any guest an owner removes: the row
        -- carries the `display_name_snapshot` the roster shows for somebody who is
        -- no longer here (spec §5.2), and deleting the identity would delete the
        -- name with it. Widening the sweep to `status = 'active'` would be a change
        -- to a retention rule, which is §8.5's and wants an ADR, not a line here.
      else
        -- `status = 'active'` above, and not merely "has a row", because the
        -- account may hold a membership of this circle that *ended*. Treating
        -- that as a collision removed the guest's live membership and
        -- `on_member_removed` deleted the availability they had just submitted —
        -- so saving your place cost you the circle, which is the opposite of
        -- "linking the existing guest membership. Nothing already sent changes"
        -- (spec §5.1).
        --
        -- The old row is the same person's, under the name they had then, and its
        -- answers are long gone. It is deleted to make room rather than revived:
        -- the membership that matters is the live one, and a primary key of
        -- `(circle_id, user_id)` has room for exactly one.
        -- The residue first. A real removal is an UPDATE, so `on_member_removed`
        -- ran — and it leaves being required, the participant row on a confirmed
        -- plan, the prompts already shown, an interest answer, and an attendance
        -- it rewrote to `cant`. Every one of those collides with the guest's row
        -- for the same plan, and deleting only the membership row let the claim
        -- abort on a primary key instead.
        perform private.discard_membership_rows(
          membership.circle_id, p_user_id, p_anonymous_user_id
        );

        delete from public.circle_members m
        where m.circle_id = membership.circle_id and m.user_id = p_user_id
          and m.status = 'removed';

        -- The name the circle knows them by travels with the membership rather
        -- than being replaced by the profile's. Nobody's roster entry should
        -- change because somebody else signed in.
        perform private.move_membership(membership.circle_id, p_anonymous_user_id, p_user_id);
        merged := merged + 1;
      end if;

      -- The link, recorded. Either branch leaves one person's contacts on both
      -- identities (`reconcile_contacts` splits a contact whose identity keeps
      -- another circle's consent, with the verification link on the side left
      -- behind), and verifying an address promotes only the same person's
      -- contacts (ADR 0049) — which `private.same_person_identities` reads from
      -- here and from `reattach_member`'s rows. Ids and a circle, nothing else.
      insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
      values (p_user_id, 'circles.member_claimed', 'circle', membership.circle_id,
              jsonb_build_object('from_user_id', p_anonymous_user_id, 'to_user_id', p_user_id));
    end loop;
  end if;

  -- Once per account, whatever the client retries. The audit log is the record
  -- rather than the outbox, because the outbox is drained and swept and this has
  -- to stay true for longer than that.
  if not exists (
    select 1 from private.audit_log a
    where a.action = 'growth.account_claimed' and a.resource_id = p_user_id
  ) then
    insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
    values (p_user_id, 'growth.account_claimed', 'account', p_user_id,
            jsonb_build_object('moment', p_moment, 'merged_memberships', merged));

    perform jobs.emit('growth.account_claimed', 'account', p_user_id,
      jsonb_build_object('user_id', p_user_id, 'moment', p_moment));
  end if;

  return query select merged, removed;
end;
$$;

comment on function public.claim_identity(uuid, uuid, text) is
  'Reconciles an anonymous identity''s memberships onto a permanent one after sign-in (§10), returning how many moved and how many duplicates were removed. Service role only: the anonymous identity is a parameter, and its proof is a token only the Edge Function can check.';

revoke all on function public.claim_identity(uuid, uuid, text) from public;
revoke all on function public.claim_identity(uuid, uuid, text) from anon, authenticated;
grant execute on function public.claim_identity(uuid, uuid, text) to service_role;

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
