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
-- The residue goes, and the guest's rows become the truth. Two reasons that is the
-- right way round rather than the other: the guest rows are what this person has
-- been doing lately, and the account's are about a membership that ended — a
-- `cant` written *by the removal itself* is not an answer anybody gave.
-- ---------------------------------------------------------------------------

create or replace function private.discard_membership_rows(
  p_circle_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.attendance a
  where a.user_id = p_user_id
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans pl on pl.id = c.plan_id
      where pl.circle_id = p_circle_id
    );

  delete from public.plan_responses r
  where r.user_id = p_user_id
    and r.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

  delete from public.plan_participants pp
  where pp.user_id = p_user_id
    and pp.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

  delete from public.plan_required_members rm
  where rm.user_id = p_user_id
    and rm.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

  delete from public.nudge_states n
  where n.user_id = p_user_id
    and n.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

  delete from private.plan_interest i
  where i.user_id = p_user_id
    and i.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

  -- `member_dayparts` and any re-entry token go with the membership row itself,
  -- which references `circle_members` with `on delete cascade`.
end;
$$;

comment on function private.discard_membership_rows(uuid, uuid) is
  'Clears what a removed membership left behind in one circle, so the same person returning as a guest can be merged onto it without colliding.';

revoke all on function private.discard_membership_rows(uuid, uuid) from public;
revoke all on function private.discard_membership_rows(uuid, uuid) from anon, authenticated;
