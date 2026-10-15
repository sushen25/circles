-- A suppressed contact keeps the hash of its address and not the address.
--
-- `private.email_suppressions` already holds the tombstone that keeps the
-- promise not to send again, and it is a hash. Nothing mails a suppressed
-- contact, so the clear address on its row serves nobody and used to sit there
-- for ever (retention took only verified contacts). Once a row is suppressed,
-- by whichever path — a bounce, a complaint, an unsubscribe, or an insert for
-- an address that was already tombstoned — this trigger nulls it.
--
-- That needed the hash to stop being derived from the address. `email_hash`
-- was a generated column over `email_normalized`; it is a plain column now,
-- and this trigger is the only thing that writes it: whenever a row arrives or
-- changes with an address, the hash is recomputed from it, so a writer still
-- cannot pair an address with the hash of something else. A row with no
-- address (a suppressed one) keeps the hash it had, and a writer copying such
-- a row — `reconcile_contacts` splitting a contact for another identity —
-- supplies the hash itself.
--
-- A row cannot hold neither: the table's `email_contacts_address_kept` check
-- says the address is null exactly when the status is `suppressed`.
create or replace function private.apply_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tombstone private.email_suppressions;
begin
  if new.email_normalized is not null then
    new.email_hash := extensions.digest(new.email_normalized, 'sha256');
  end if;

  if tg_op = 'INSERT' then
    select * into tombstone from private.email_suppressions t
    where t.email_hash = new.email_hash;
    if found then
      new.status := 'suppressed';
      new.suppression_reason := tombstone.reason;
      new.suppressed_at := tombstone.suppressed_at;
      new.verified_at := null;
    end if;
  end if;

  if new.status = 'suppressed' then
    new.email_normalized := null;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_suppression() from public;
revoke all on function private.apply_suppression() from anon, authenticated;
