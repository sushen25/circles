-- ---------------------------------------------------------------------------
-- The identities that count as one person for verifying an address
-- (ADR 0049).
--
-- Verifying an address proves that whoever held the link controls it. It says
-- nothing about another identity's consent, so promotion stops at "the same
-- person": the identity itself, and any identity **directly** linked to it by a
-- reattachment. `reattach_member` records both ids in `private.audit_log`
-- (`circles.member_reattached`, written in the move's own transaction), and
-- `reconcile_contacts` is what leaves one person holding one address on two
-- contacts, one on each end of that move.
--
-- Direct, in either direction, and not the transitive closure: one identity that
-- takes several people's places would otherwise link all of them to each other.
--
-- Nothing else makes two identities one person. Not the same address, circle or
-- time. A claim (`claim_identity`) is not a row here and needs none: it moves or
-- merges the guest's contacts into the saved place's own, so nothing of the
-- person is left behind to link to.
-- ---------------------------------------------------------------------------

create or replace function private.same_person_identities(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id
  union
  select (
    case when a.metadata ->> 'from_user_id' = p_user_id::text
      then a.metadata ->> 'to_user_id'
      else a.metadata ->> 'from_user_id'
    end
  )::uuid
  from private.audit_log a
  where a.action = 'circles.member_reattached'
    and p_user_id::text in (a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id');
$$;

comment on function private.same_person_identities(uuid) is
  'An identity and the identities directly linked to it by a recorded reattachment: the set whose pending contacts verifying an address may promote (ADR 0049).';

revoke all on function private.same_person_identities(uuid) from public;
revoke all on function private.same_person_identities(uuid) from anon, authenticated;
grant execute on function private.same_person_identities(uuid) to service_role;
