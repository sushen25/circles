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
begin
  -- Outstanding emailed links first, while `membership_user_id` still names the
  -- identity they were issued against: the write below cascades that column, and
  -- `enforce_reentry_for_guests` fires on it. `private.retire_reentry_links` says
  -- what happens and why, and `reconcile_contacts` calls it too — the
  -- duplicate-merge path reaches the same tokens by a different route.
  perform private.retire_reentry_links(p_circle_id, p_from, p_to);

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

  -- The address this membership is reachable at, and everything hanging off it.
  -- In `private.reconcile_contacts`, shared with `adopt_membership_rows`, because
  -- the duplicate-merge path needs exactly the same work and having it here only
  -- left that path stranding a retired membership's consent and links.
  perform private.reconcile_contacts(p_circle_id, p_from, p_to);

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
