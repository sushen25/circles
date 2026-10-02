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
