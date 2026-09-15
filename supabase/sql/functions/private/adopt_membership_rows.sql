-- ---------------------------------------------------------------------------
-- The same person, twice in one circle, and only one row may survive.
--
-- `claim_identity` meets this when somebody joined from two devices under two
-- names (spec §9) and then saves their place: both identities are active members,
-- the saved place is the one that keeps working, and the guest row goes.
--
-- But "the guest row goes" must not mean "what the guest did goes". Answers,
-- attendance, participation, being required, an interest answer — each is
-- something this person actually did, and `on_member_removed` deletes or neutralises
-- them when the membership is removed (spec §4.5). So everything the survivor does
-- *not already have* is adopted first, and only what is genuinely duplicated is
-- left to be cleaned up.
--
-- The counterpart of `private.move_membership`, and the difference is the whole
-- point: that one moves rows unconditionally, because the destination has no
-- membership to collide with. This one moves only into the gaps.
--
-- The address is reconciled too, through the same `private.reconcile_contacts`
-- the move path uses. Leaving the duplicate's contact behind was the first
-- version of this, on the reasoning that a removed membership is ineligible for
-- notification anyway — but it also leaves any emailed `/a/<token>` link bound to
-- a membership that no longer exists, and an email already sent is not ours to
-- break (spec §5.1).
-- ---------------------------------------------------------------------------

create or replace function private.adopt_membership_rows(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The inputs are not changing, only whose they are — see `bump_input_version`.
  -- Local to the transaction, so it cannot leak into anything else.
  perform set_config('circles.moving_membership', 'on', true);

  -- Participation first: `enforce_attendance_transition` refuses an attendance
  -- row whose owner is not a participant of the confirmation's revision, so
  -- adopting attendance before participation would raise and take the whole
  -- claim with it.
  update public.plan_participants pp
  set user_id = p_to
  where pp.user_id = p_from
    and pp.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.plan_participants kept
      where kept.plan_id = pp.plan_id and kept.revision = pp.revision and kept.user_id = p_to
    );

  update public.plan_responses r
  set user_id = p_to
  where r.user_id = p_from
    and r.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.plan_responses kept
      where kept.plan_id = r.plan_id and kept.revision = r.revision and kept.user_id = p_to
    );

  -- The organiser's decision that *this person* has to be there.
  -- `on_member_removed` leaves this table alone on purpose — spec §9 makes a
  -- required person leaving the organiser's problem to resolve — but nobody is
  -- leaving here, so the requirement follows them. Otherwise an active plan would
  -- go on requiring an identity that can no longer answer.
  update public.plan_required_members rm
  set user_id = p_to
  where rm.user_id = p_from
    and rm.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.plan_required_members kept
      where kept.plan_id = rm.plan_id and kept.revision = rm.revision and kept.user_id = p_to
    );

  update public.attendance a
  set user_id = p_to
  where a.user_id = p_from
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans pl on pl.id = c.plan_id
      where pl.circle_id = p_circle_id
    )
    and not exists (
      select 1 from public.attendance kept
      where kept.confirmation_id = a.confirmation_id and kept.user_id = p_to
    )
    -- And only where the revision knows the survivor, which the participation
    -- update above has just made true wherever it can be.
    and exists (
      select 1 from public.plan_participants pp
      join public.meetup_confirmations c on c.id = a.confirmation_id
      where pp.plan_id = c.plan_id and pp.revision = c.revision and pp.user_id = p_to
    );

  -- A quiet ask's interest answer. Two rows for one person would count them
  -- twice towards the threshold, which is the one number the quiet ask turns on.
  update private.plan_interest i
  set user_id = p_to
  where i.user_id = p_from
    and i.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from private.plan_interest kept
      where kept.plan_id = i.plan_id and kept.user_id = p_to
    );

  -- Prompts already shown, so the survivor is not shown them again.
  update public.nudge_states n
  set user_id = p_to
  where n.user_id = p_from
    and n.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and not exists (
      select 1 from public.nudge_states kept
      where kept.user_id = p_to and kept.moment = n.moment
        and kept.plan_id is not distinct from n.plan_id
    );

  -- And the measurements, which follow the person like everything else here.
  -- No `not exists` guard: an event is a record of a moment rather than a row
  -- one identity may hold once, so two of them surviving a merge is two things
  -- that happened, which is the truth. (`analytics.events` has no foreign key
  -- to `auth.users` — an event outlives what it was about — so it is easy to
  -- miss when reading for tables that point at an identity.)
  update analytics.events e set user_id = p_to
  where e.user_id = p_from
    and (
      e.circle_id = p_circle_id
      or e.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    );

  perform private.reconcile_contacts(p_circle_id, p_from, p_to);
  perform set_config('circles.moving_membership', 'off', true);
end;
$$;

comment on function private.adopt_membership_rows(uuid, uuid, uuid) is
  'Moves a duplicate membership''s rows onto the surviving one, but only where the survivor has none. The gap-filling counterpart of move_membership.';

revoke all on function private.adopt_membership_rows(uuid, uuid, uuid) from public;
revoke all on function private.adopt_membership_rows(uuid, uuid, uuid) from anon, authenticated;
