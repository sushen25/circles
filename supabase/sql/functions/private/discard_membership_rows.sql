-- ---------------------------------------------------------------------------
-- What a membership that ended left behind.
--
-- `on_member_removed` does not clear everything when somebody is removed, and
-- deliberately: being required stays (spec §9 makes a required person leaving the
-- organiser's problem to resolve), a `going` on a meetup that has already happened
-- stays as part of the historic aggregate §4.5 allows, and a `going` still ahead
-- becomes `cant` rather than disappearing.
--
-- All of which is correct for a removal, and all of which is in the way when the
-- *same person* comes back. `claim_identity` meets that: an account was in this
-- circle and left, the person returned through the link as a guest — Continue-as
-- cannot list a saved place, so they had no choice — and now signs in. The
-- account's residue collides with the guest's rows on every table keyed by
-- `(plan, revision, user)`, and the first version of this branch deleted only the
-- membership row, so the claim aborted on a primary key.
--
-- The *colliding* residue goes, and the guest's rows become the truth there. Two
-- reasons that is the right way round: the guest rows are what this person has been
-- doing lately, and the account's are about a membership that ended — a `cant`
-- written *by the removal itself* is not an answer anybody gave.
--
-- Which is a reason, not a promise: a removal-written `cant` on a meetup still ahead
-- survives if the returning guest has no attendance of their own on it, because
-- nothing collides and this function clears only collisions. Correcting that would
-- mean knowing which `cant` the removal wrote, and `attendance` does not record it.
-- The person can change their answer, which is what that screen is for.
--
-- Nothing else goes. Spec §4.5 lets a removed member's "historic aggregate
-- attendance" remain and `on_member_removed` deliberately keeps a past
-- `was_there`; clearing the lot threw away the record that somebody turned up,
-- which is the one thing this product is trying to measure.
-- ---------------------------------------------------------------------------

create or replace function private.discard_membership_rows(
  p_circle_id uuid,
  p_user_id uuid,
  /**
   * The identity whose rows are about to take their place. Only what *collides*
   * with that identity is cleared, which is the whole job: spec §4.5 lets "historic
   * aggregate attendance" remain for a removed member, and `on_member_removed`
   * goes out of its way to keep a past `was_there`. Deleting all of it — which this
   * function did at first — threw away the evidence that somebody turned up.
   */
  p_in_favour_of uuid
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

  delete from public.attendance a
  where a.user_id = p_user_id
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans pl on pl.id = c.plan_id
      where pl.circle_id = p_circle_id
    )
    and exists (
      select 1 from public.attendance mine
      where mine.confirmation_id = a.confirmation_id and mine.user_id = p_in_favour_of
    );

  delete from public.plan_responses r
  where r.user_id = p_user_id
    and r.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and exists (
      select 1 from public.plan_responses mine
      where mine.plan_id = r.plan_id and mine.revision = r.revision
        and mine.user_id = p_in_favour_of
    );

  delete from public.plan_participants pp
  where pp.user_id = p_user_id
    and pp.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and exists (
      select 1 from public.plan_participants mine
      where mine.plan_id = pp.plan_id and mine.revision = pp.revision
        and mine.user_id = p_in_favour_of
    );

  delete from public.plan_required_members rm
  where rm.user_id = p_user_id
    and rm.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and exists (
      select 1 from public.plan_required_members mine
      where mine.plan_id = rm.plan_id and mine.revision = rm.revision
        and mine.user_id = p_in_favour_of
    );

  delete from public.nudge_states n
  where n.user_id = p_user_id
    and n.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and exists (
      select 1 from public.nudge_states mine
      where mine.user_id = p_in_favour_of and mine.moment = n.moment
        and mine.plan_id is not distinct from n.plan_id
    );

  delete from private.plan_interest i
  where i.user_id = p_user_id
    and i.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
    and exists (
      select 1 from private.plan_interest mine
      where mine.plan_id = i.plan_id and mine.user_id = p_in_favour_of
    );

  -- `member_dayparts` and any re-entry token go with the membership row itself,
  -- which references `circle_members` with `on delete cascade`.
  perform set_config('circles.moving_membership', 'off', true);
end;
$$;

comment on function private.discard_membership_rows(uuid, uuid, uuid) is
  'Clears only what a removed membership left behind that would collide with the identity taking its place. History that collides with nothing stays (spec §4.5).';

revoke all on function private.discard_membership_rows(uuid, uuid, uuid) from public;
revoke all on function private.discard_membership_rows(uuid, uuid, uuid) from anon, authenticated;
