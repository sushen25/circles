-- ---------------------------------------------------------------------------
-- May an emailed re-entry link take a place back from a saved account?
-- (ADR 0048, decision 6; the founder's decision of 3 October 2026.)
--
-- A saved place is never *offered* by the list and never moved by a pick, and that
-- stays. This is the one exception, and it is for a person who proves the address
-- the place was reachable at: if somebody took a guest's place from the Continue-as
-- list and then saved it as their own account, the real guest's emailed link must
-- still get them back, or the takeover is permanent.
--
-- Yes only when all of these hold, and the answer is a plain boolean so that every
-- way of being unsure is a no:
--
--   * the holder really is a saved account, by `auth.users` (the record only the
--     auth server writes), not by a profile flag or a token that may be stale;
--   * the holder does not own the circle: an owner stays a member
--     (`enforce_owner_stays_member`), and handing a circle on is its own operation;
--   * **the account's own address is not the link's address.** An account whose
--     email is the address the link was sent to is the same person, signed in, and
--     keeps the place. Compared lower-cased, against `auth.users.email` and every
--     address on the account's sign-in identities. An account with *no* address of
--     its own (a phone sign-in) has none to match, so the link is not the account
--     holder's and may take the place back.
-- ---------------------------------------------------------------------------

create or replace function private.takeback_allowed(
  p_circle_id uuid,
  p_holder uuid,
  p_contact_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from auth.users u where u.id = p_holder and not coalesce(u.is_anonymous, true)
    )
    and exists (select 1 from private.email_contacts k where k.id = p_contact_id)
    and not exists (
      select 1 from public.circles c where c.id = p_circle_id and c.owner_user_id = p_holder
    )
    and not exists (
      select 1
      from private.email_contacts k
      where k.id = p_contact_id
        and (
          exists (
            select 1 from auth.users u
            where u.id = p_holder and lower(btrim(u.email)) = lower(btrim(k.email_normalized))
          )
          or exists (
            select 1 from auth.identities i
            where i.user_id = p_holder
              and lower(btrim(i.identity_data ->> 'email')) = lower(btrim(k.email_normalized))
          )
        )
    );
$$;

comment on function private.takeback_allowed(uuid, uuid, uuid) is
  'Whether an emailed re-entry link may take a place back from a saved account: the holder is a real account, not the circle''s owner, and its own address is not the link''s. Every doubt is a no.';

revoke all on function private.takeback_allowed(uuid, uuid, uuid) from public;
revoke all on function private.takeback_allowed(uuid, uuid, uuid) from anon, authenticated;
