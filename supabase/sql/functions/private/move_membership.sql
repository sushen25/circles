-- ---------------------------------------------------------------------------
-- One membership, one circle, from one identity to another.
--
-- Both paths that move a membership use this: `reattach_member`, when a guest
-- comes back with no session (ADR 0006), and `claim_identity`, when somebody
-- saves their place and turns out to have had a permanent identity already.
-- One copy, because the cost of two is a table moved by one of them and left
-- behind by the other — and "left behind" means a guest who reattaches and
-- finds their answers gone.
--
-- It decides nothing. Who may move what is the caller's question: this assumes
-- it has already been answered and does the writing.
--
-- `member_dayparts` and any re-entry token for the membership are absent below
-- because they move themselves — both reference `circle_members` with
-- `on update cascade`, which 0006 and 0007 put there for this moment.
--
-- `analytics.events` is also deliberately absent, and it is the one table here
-- that *should* be: an event is a record of something that happened to an
-- identity at a time, and rewriting it would be rewriting history rather than
-- following a person. It has no foreign key to `auth.users`, so nothing
-- cascades it away either.
-- ---------------------------------------------------------------------------

create or replace function private.move_membership(
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
  -- A re-entry token is a guest's way back in *without* signing in, which is why
  -- `enforce_reentry_for_guests` refuses to issue one against a saved place. When
  -- a membership becomes a saved-place member's, any token bound to it has to go
  -- for exactly that reason — and it has to go *first*, because
  -- `email_action_tokens.membership_user_id` follows `circle_members` by cascade
  -- and the trigger fires on that update, refusing the whole move.
  --
  -- Deleted rather than marked spent: the trigger watches every update of the
  -- column, so a spent row would be carried across and refused just the same.
  -- Nothing is lost — a token that matches no row is already `token_invalid`.
  if exists (select 1 from public.profiles p where p.user_id = p_to and p.is_permanent)
    or exists (
      select 1 from auth.users u where u.id = p_to and not coalesce(u.is_anonymous, false)
    )
  then
    delete from private.email_action_tokens t
    where t.purpose = 'reentry'
      and t.membership_circle_id = p_circle_id
      and t.membership_user_id = p_from;
  end if;

  -- The membership itself, first: the cascading references follow this write.
  update public.circle_members m
  set user_id = p_to
  where m.circle_id = p_circle_id and m.user_id = p_from;

  -- Everything else the member owns. Each of these references `auth.users`
  -- with no action on update, so each is moved by name — and
  -- `090_identity_continuity.sql` checks the list against the catalogue rather
  -- than trusting that it is complete.
  update public.plan_responses r set user_id = p_to
  where r.user_id = p_from
    and r.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_participants pp set user_id = p_to
  where pp.user_id = p_from
    and pp.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_required_members rm set user_id = p_to
  where rm.user_id = p_from
    and rm.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.attendance a set user_id = p_to
  where a.user_id = p_from
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where p.circle_id = p_circle_id
    );

  update public.nudge_states n set user_id = p_to
  where n.user_id = p_from
    and n.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update private.plan_interest i set user_id = p_to
  where i.user_id = p_from
    and i.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The availability snapshots name who could come, and `transition_plan` reads
  -- the candidate's array at confirm time to decide who is `going`. A stale id
  -- there is this person marked `unknown` at the one moment the product is
  -- about.
  update public.candidates c
  set available_user_ids = array_replace(c.available_user_ids, p_from, p_to)
  where p_from = any (c.available_user_ids)
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  update public.meetup_confirmations mc
  set available_user_ids = array_replace(mc.available_user_ids, p_from, p_to)
  where p_from = any (mc.available_user_ids)
    and mc.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The member's own email contact, where one is tied to this circle. It has to
  -- come along: a re-entry token's `(contact_id, membership_user_id)` pair is
  -- checked against `email_contacts (id, user_id)` at commit, so a contact left
  -- behind fails the deferred constraint and takes the whole move with it.
  --
  -- **Merged, not moved**, when the destination already holds that address.
  -- Uniqueness is `(email_hash, user_id)` (0009), so moving would collide and
  -- roll back everything above it — and the architecture's table for
  -- `email_action_tokens` says so in as many words: "It must **merge** rather
  -- than move the *contact*". The case is ordinary rather than exotic: a guest
  -- asks for plan-update email at an address, then saves their place and turns
  -- out to have an account at the same address.
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
        -- Ties outside this circle. One address, one identity, and an identity can
        -- be in several circles — so handing the contact over whole would carry
        -- another circle's consent to an identity that is not a member of it, and
        -- leave a re-entry token for that other membership pointing at a pair that
        -- no longer exists. "A reattachment moves a membership only within a
        -- circle the guest already belongs to" (AGENTS.md) is about the
        -- membership; it is just as true of what hangs off it.
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
        -- Nothing outside this circle, and nowhere to merge into: the contact
        -- itself travels, and everything hanging off it comes by cascade.
        update private.email_contacts ec set user_id = p_to where ec.id = contact.id;
        continue;
      end if;
    end if;

    -- From here one rule, whichever branch arrived: **only this circle's rows
    -- move**, onto `destination_contact`.
    --
    -- Consent first, and a collision is consent the destination already gave.
    -- `email_subscriptions_one_per_plan_idx` is on `(contact_id, scope, plan_id)`,
    -- so re-pointing a second subscription for one plan violates it and rolls the
    -- whole move back. The destination's row survives, because it belongs to the
    -- identity that persists; two consents to one plan at one address say nothing
    -- different from one.
    delete from private.email_subscriptions sub
    where sub.contact_id = contact.id
      and sub.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
      and exists (
        select 1 from private.email_subscriptions kept
        where kept.contact_id = destination_contact
          and kept.scope = sub.scope
          and kept.plan_id is not distinct from sub.plan_id
      );

    update private.email_subscriptions sub
    set contact_id = destination_contact, user_id = p_to
    where sub.contact_id = contact.id
      and sub.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

    update private.email_action_tokens tok
    set contact_id = destination_contact
    where tok.contact_id = contact.id and tok.membership_circle_id = p_circle_id;

    -- Mail already queued for this address. An email job names a *contact* and
    -- carries no `user_id` at all (0006 forbids both at once), so the `user_id`
    -- update below cannot save it — and `notification_jobs_contact_fkey` is
    -- `on delete cascade`, so the delete that follows would take every unsent
    -- message with it. Silently: somebody waiting for "locked in" would never
    -- get it.
    update jobs.notification_jobs job
    set contact_id = destination_contact
    where job.contact_id = contact.id
      and job.sent_at is null
      and job.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

    -- And the old row goes only once nothing points at it any more. A contact
    -- still holding another circle's consent is that circle's, and stays.
    delete from private.email_contacts ec
    where ec.id = contact.id
      and not exists (select 1 from private.email_subscriptions sub where sub.contact_id = ec.id)
      and not exists (select 1 from private.email_action_tokens tok where tok.contact_id = ec.id)
      and not exists (select 1 from jobs.notification_jobs job where job.contact_id = ec.id);
  end loop;

  -- Queued mail for the person, not yet sent. A job left on the old identity is
  -- a message the dispatcher either sends to nobody or drops when retention
  -- takes the abandoned identity with it.
  update jobs.notification_jobs j set user_id = p_to
  where j.user_id = p_from
    and j.sent_at is null
    and j.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);
end;
$$;

comment on function private.move_membership(uuid, uuid, uuid) is
  'Moves one circle membership and every row scoped to it from one identity to another. Shared by reattach_member and claim_identity; decides nothing.';

revoke all on function private.move_membership(uuid, uuid, uuid) from public;
revoke all on function private.move_membership(uuid, uuid, uuid) from anon, authenticated;
