-- ---------------------------------------------------------------------------
-- May an emailed re-entry link take a place back from a saved account?
-- (ADR 0049, decision 6; the founder's decision of 3 October 2026.)
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
--   * the holder does not own the circle (an owner stays a member,
--     `enforce_owner_stays_member`, and handing a circle on is its own operation)
--     and does not organise a plan that is still open: the plan's guards want its
--     organiser to be a member, so taking the place would strand it until the
--     owner cancels it. The account keeps the place until then;
--   * **the link's address is one the place's first holder had.** Walking the
--     recorded moves back from the holder (through claims) there is a move made by
--     the list, and the address is one that a link was once minted for the place's
--     *first holder*: the identity nobody moved the place to (or, in a loop, the
--     earliest mover). `email_action_tokens.minted_for_user_id` records whom each
--     link was minted for and never moves with the place. That is the story this
--     rule is for: a guest's place was picked from the list and then saved, and the
--     link is to the guest's own mailbox. Without it, a link to a taker's own
--     mailbox (minted for somebody who held the place *later*) could take the place
--     from the real guest once she had saved it, whether she came back by email or
--     by picking her own name; a saved account has no link of its own to answer
--     with. Keyed on the address and not on the identity the link names, so a guest
--     who has changed identity (new device, an emailed return) and whose newest
--     letter is minted for her current one is still recognised;
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
      select 1 from public.plans pl
      where pl.circle_id = p_circle_id and pl.organiser_user_id = p_holder
        and pl.state not in ('cancelled', 'expired', 'completed')
    )
    and exists (
      with recursive chain (id, from_id, to_id, picked, at) as (
        select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
               a.action = 'circles.member_reattached'
                 and coalesce(a.metadata ->> 'source', 'list') = 'list',
               a.occurred_at
        from private.audit_log a
        where a.resource_type = 'circle' and a.resource_id = p_circle_id
          and a.action in ('circles.member_reattached', 'circles.member_claimed')
          and a.metadata ->> 'to_user_id' = p_holder::text
        union
        select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
               a.action = 'circles.member_reattached'
                 and coalesce(a.metadata ->> 'source', 'list') = 'list',
               a.occurred_at
        from private.audit_log a
        join chain on a.metadata ->> 'to_user_id' = chain.from_id
        where a.resource_type = 'circle' and a.resource_id = p_circle_id
          and a.action in ('circles.member_reattached', 'circles.member_claimed')
      ),
      firsts as (
        select c.from_id from chain c
        where not exists (select 1 from chain x where x.to_id = c.from_id)
        union
        select (select e.from_id from chain e order by e.at, e.id limit 1)
        where not exists (
          select 1 from chain c where not exists (select 1 from chain x where x.to_id = c.from_id)
        )
      )
      select 1
      where exists (select 1 from chain where picked)
        and exists (
          select 1
          from private.email_action_tokens t
          join private.email_contacts tk on tk.id = t.contact_id
          join private.email_contacts k on k.id = p_contact_id and k.email_hash = tk.email_hash
          where t.purpose = 'reentry' and t.membership_circle_id = p_circle_id
            and t.minted_for_user_id::text in (select f.from_id from firsts f)
        )
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
  'Whether an emailed re-entry link may take a place back from a saved account: a real account, not the circle''s owner or an open plan''s organiser, whose own address is not the link''s, and and whose place was picked from the first holder, whose address the link is. Every doubt is a no.';

revoke all on function private.takeback_allowed(uuid, uuid, uuid) from public;
revoke all on function private.takeback_allowed(uuid, uuid, uuid) from anon, authenticated;
