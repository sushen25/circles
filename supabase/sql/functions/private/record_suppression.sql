-- A suppression is the address's, not the contact's.
--
-- Two things follow from that, and both are here because both have to happen
-- together. The tombstone in `private.email_suppressions` outlives the contact,
-- so an address that complained stays suppressed even after its contact is
-- deleted and a new one is created later — `apply_suppression` reads it on
-- insert.
--
-- And **every contact already holding that address is suppressed with it.**
-- Since uniqueness moved to `(email_hash, user_id)` (0009) two identities can
-- be reachable at one address, so suppressing only the row the webhook named
-- would leave a sibling `verified` and the dispatcher would keep mailing an
-- address that complained. The tombstone alone does not cover this: it is
-- consulted on insert, and the sibling already exists.
--
-- The recursion terminates because the sibling update only touches rows that
-- are not yet suppressed, so the trigger it fires finds none.
create or replace function private.record_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'suppressed' and (tg_op = 'INSERT' or old.status is distinct from 'suppressed') then
    insert into private.email_suppressions (email_hash, reason, suppressed_at)
    values (new.email_hash, new.suppression_reason, new.suppressed_at)
    on conflict (email_hash) do nothing;

    update private.email_contacts c
    set status = 'suppressed',
        suppressed_at = new.suppressed_at,
        suppression_reason = new.suppression_reason,
        verified_at = null
    where c.email_hash = new.email_hash
      and c.id <> new.id
      and c.status <> 'suppressed';
  end if;
  return null;
end;
$$;

revoke all on function private.record_suppression() from public;
revoke all on function private.record_suppression() from anon, authenticated;
