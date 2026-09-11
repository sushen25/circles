-- ---------------------------------------------------------------------------
-- The address a membership is reachable at, when the membership changes hands.
--
-- Shared by `move_membership` (the destination has no membership here) and
-- `adopt_membership_rows` (it has one, and the duplicate is being retired),
-- because the work is the same either way and the first version of this ticket
-- had it in one and not the other — which left a retired duplicate's consent and
-- its emailed links bound to a membership that no longer exists.
--
-- Three rules, in order of how badly getting them wrong would hurt:
--
--   * **Only this circle's rows move.** A contact belongs to an identity and an
--     identity can be in several circles, so handing the contact over whole would
--     carry another circle's consent to an identity that is not a member of it.
--   * **A withdrawal survives a merge.** Where both identities hold consent for
--     one plan at one address, the result is withdrawn if *either* of them is.
--     Choosing by identity — "the destination's row is the one that persists" —
--     discards an unsubscribe, and unsubscribing is immediate here (§14, and the
--     Spam Act).
--   * **Queued mail is re-pointed before anything is deleted.** An email job names
--     a contact and carries no `user_id` at all, and
--     `notification_jobs_contact_fkey` is `on delete cascade`: the tidy-up would
--     otherwise take away messages somebody is waiting for, without a word.
-- ---------------------------------------------------------------------------

create or replace function private.reconcile_contacts(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact record;
  destination_contact uuid;
begin
  -- Before the contact is touched at all. Every branch below either moves the
  -- contact — whose `user_id` cascades into `email_action_tokens.membership_user_id`
  -- — or re-points the token's `contact_id`, and an unspent re-entry token arriving
  -- at a permanent identity is refused by `enforce_reentry_for_guests`. That
  -- refusal took the whole claim with it, which made saving your place impossible
  -- for exactly the people who had asked to be emailed.
  perform private.retire_reentry_links(p_circle_id, p_from, p_to);

  for contact in
    select ec.id, ec.email_hash
    from private.email_contacts ec
    where ec.user_id = p_from
      and (
        exists (
          select 1 from private.email_subscriptions s
          join public.plans p on p.id = s.plan_id
          where s.contact_id = ec.id and p.circle_id = p_circle_id
        )
        or exists (
          select 1 from private.email_action_tokens t
          where t.contact_id = ec.id and t.membership_circle_id = p_circle_id
        )
      )
  loop
    select ec.id into destination_contact
    from private.email_contacts ec
    where ec.user_id = p_to and ec.email_hash = contact.email_hash;

    if not found then
      if exists (
        -- Ties outside this circle, which must not travel.
        select 1 from private.email_subscriptions other
        join public.plans pl on pl.id = other.plan_id
        where other.contact_id = contact.id and pl.circle_id <> p_circle_id
        union all
        select 1 from private.email_action_tokens other
        where other.contact_id = contact.id
          and other.membership_circle_id is distinct from p_circle_id
      ) then
        -- Split: a copy for the destination carrying the same address and the
        -- same standing — verified stays verified, because it is the same person
        -- and the same address, and suppressed stays suppressed, because that is
        -- global by hash (spec §9). Uniqueness is `(email_hash, user_id)`, so two
        -- identities holding one address is what 0009 made legal.
        insert into private.email_contacts
          (user_id, email_normalized, status, verified_at, suppressed_at, suppression_reason)
        select p_to, ec.email_normalized, ec.status, ec.verified_at, ec.suppressed_at,
               ec.suppression_reason
        from private.email_contacts ec
        where ec.id = contact.id
        returning id into destination_contact;
      else
        -- Nothing outside this circle and nowhere to merge into: the contact
        -- itself travels, and everything hanging off it comes by cascade.
        update private.email_contacts ec set user_id = p_to where ec.id = contact.id;
        continue;
      end if;
    end if;

    -- Consent, where the destination already has some for the same plan. The
    -- unique index is on `(contact_id, scope, plan_id)`, so the two cannot simply
    -- both be re-pointed — and which one survives is not a question about
    -- identities.
    update private.email_subscriptions kept
    set status = 'withdrawn',
        withdrawn_at = coalesce(kept.withdrawn_at, source.withdrawn_at, now())
    from private.email_subscriptions source
    where kept.contact_id = destination_contact
      and source.contact_id = contact.id
      and source.scope = kept.scope
      and source.plan_id is not distinct from kept.plan_id
      and source.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
      -- Either side having withdrawn makes the answer withdrawn. A merge is not a
      -- new consent, and it must never be a way to undo an unsubscribe.
      and 'withdrawn' in (source.status, kept.status)
      and kept.status <> 'withdrawn';

    delete from private.email_subscriptions source
    where source.contact_id = contact.id
      and source.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
      and exists (
        select 1 from private.email_subscriptions kept
        where kept.contact_id = destination_contact
          and kept.scope = source.scope
          and kept.plan_id is not distinct from source.plan_id
      );

    update private.email_subscriptions sub
    set contact_id = destination_contact, user_id = p_to
    where sub.contact_id = contact.id
      and sub.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

    -- The membership as well as the contact. In the move path the cascade has
    -- already taken `membership_user_id` to `p_to`; in the duplicate-merge path the
    -- membership never moved, and leaving the token on the identity being retired
    -- both breaks the composite foreign key — `(contact_id, membership_user_id)`
    -- must be a real `(id, user_id)` pair on `email_contacts` — and leaves an
    -- emailed link pointing at a membership that is about to be removed.
    update private.email_action_tokens tok
    set contact_id = destination_contact, membership_user_id = p_to
    where tok.contact_id = contact.id and tok.membership_circle_id = p_circle_id;

    update jobs.notification_jobs job
    set contact_id = destination_contact
    where job.contact_id = contact.id
      and job.sent_at is null
      and job.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

    -- The old row goes only once nothing points at it any more. A contact still
    -- holding another circle's consent is that circle's, and stays.
    delete from private.email_contacts ec
    where ec.id = contact.id
      and not exists (select 1 from private.email_subscriptions sub where sub.contact_id = ec.id)
      and not exists (select 1 from private.email_action_tokens tok where tok.contact_id = ec.id)
      and not exists (select 1 from jobs.notification_jobs job where job.contact_id = ec.id);
  end loop;
end;
$$;

comment on function private.reconcile_contacts(uuid, uuid, uuid) is
  'Moves one circle''s email consent, links and queued mail from one identity to another, merging where both hold the address. A withdrawal survives the merge.';

revoke all on function private.reconcile_contacts(uuid, uuid, uuid) from public;
revoke all on function private.reconcile_contacts(uuid, uuid, uuid) from anon, authenticated;
