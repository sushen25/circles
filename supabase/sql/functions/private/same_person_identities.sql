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
-- chain within the circle, not one hop.
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
  with recursive reach (identity, circle_id) as (
    select p_user_id, a.resource_id
    from private.audit_log a
    where a.action = 'circles.member_reattached'
      and p_user_id::text in (a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id')
    union
    select (
      case when a.metadata ->> 'from_user_id' = r.identity::text
        then a.metadata ->> 'to_user_id'
        else a.metadata ->> 'from_user_id'
      end
    )::uuid, r.circle_id
    from reach r
    join private.audit_log a
      on a.action = 'circles.member_reattached'
     and a.resource_id = r.circle_id
     and r.identity::text in (a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id')
  )
  select p_user_id
  union
  select identity from reach
$$;

comment on function private.same_person_identities(uuid) is
  'An identity and the identities connected to it by the recorded reattachments of one circle''s membership: the set whose pending contacts verifying an address may promote (ADR 0049).';

revoke all on function private.same_person_identities(uuid) from public;
revoke all on function private.same_person_identities(uuid) from anon, authenticated;
grant execute on function private.same_person_identities(uuid) to service_role;
