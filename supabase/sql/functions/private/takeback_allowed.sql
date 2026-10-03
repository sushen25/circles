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
--   * **the holder's possession began with somebody picking a name.** Walking the
--     recorded moves back from the holder, there is a move *by the list* made after
--     the link was minted. That is the story this rule is for (a guest's place was
--     picked from the list, after the guest's link was sent). Without it, a link
--     minted for somebody who held the place *later* (a taker's own mailbox) could
--     take it from the real guest once the guest had saved it, and a saved account
--     has no link of its own to answer with;
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
  p_contact_id uuid,
  p_link_minted_at timestamptz
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
        where a.action in ('circles.member_reattached', 'circles.member_claimed')
          and a.resource_id = p_circle_id
          and a.metadata ->> 'to_user_id' = p_holder::text
        union
        select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
               a.action = 'circles.member_reattached'
                 and coalesce(a.metadata ->> 'source', 'list') = 'list',
               a.occurred_at
        from private.audit_log a
        join chain on a.metadata ->> 'to_user_id' = chain.from_id
        where a.action in ('circles.member_reattached', 'circles.member_claimed')
          and a.resource_id = p_circle_id
      )
      select 1 from chain where picked and at >= p_link_minted_at
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

comment on function private.takeback_allowed(uuid, uuid, uuid, timestamptz) is
  'Whether an emailed re-entry link may take a place back from a saved account: a real account, not the circle''s owner or an open plan''s organiser, whose own address is not the link''s, and which came to hold the place by a list pick made after the link was minted. Every doubt is a no.';

revoke all on function private.takeback_allowed(uuid, uuid, uuid, timestamptz) from public;
revoke all on function private.takeback_allowed(uuid, uuid, uuid, timestamptz) from anon, authenticated;
