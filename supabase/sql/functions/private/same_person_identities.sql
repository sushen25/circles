-- ---------------------------------------------------------------------------
-- The identities that count as one person for verifying an address
-- (ADR 0050).
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
-- start (ADR 0050, residuals).
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
  'An identity and the identities connected to it by the recorded moves (reattachment or claim) of one circle''s membership, ended by an owner''s removal: the set whose pending contacts verifying an address may promote (ADR 0050).';

revoke all on function private.same_person_identities(uuid) from public;
revoke all on function private.same_person_identities(uuid) from anon, authenticated;
grant execute on function private.same_person_identities(uuid) to service_role;
