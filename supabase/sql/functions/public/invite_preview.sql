-- ---------------------------------------------------------------------------
-- What the Join page shows before anybody has joined (spec §5.1, S1-24).
--
-- "Before any prompt the page shows: circle name, inviter's name, who is in so
-- far." A visitor holding an invite link has no session and no membership, so
-- RLS shows them nothing — and asking them to sign in, even anonymously, before
-- they have seen what they are being asked to join is the prompt §5.1 says must
-- not come first. So this answers the `anon` role.
--
-- **What authorises it is the secret.** Keyed by its SHA-256, exactly as
-- `redeem_invite` is, so the capability itself never becomes a statement
-- parameter (§14). The client hashes the fragment in the browser; the digest
-- is not a way in — `redeem-invite` takes the secret, not the digest — so
-- whoever sees one can learn only what this returns. A 256-bit secret is not a
-- space anybody walks, which is why there is no rate limit here where
-- `guest_members_for_reattach`, keyed by a short code, has one.
--
-- **What it returns is the least that draws the page.** The circle's name; the
-- name of whoever made the link, when they are still a member; and one initial
-- per active member, which is what the member marks render. Not names: the
-- page is shown to somebody who has not joined, and a link forwarded beyond the
-- group should not hand a stranger the roster. Not a plan, not a date, nothing
-- from a quiet ask — the same line `preview_for_code` holds.
--
-- A revoked invite, an unknown digest and an archived circle all return no
-- row, for the reason `redeem_invite` gives all three one error: the caller is
-- not entitled to know which. The page says "this link isn't active".
-- ---------------------------------------------------------------------------

create or replace function public.invite_preview(p_secret_hash bytea)
returns table (circle_name text, inviter_name text, member_initials text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.name,
    -- The inviter by their name *in this circle*, and only while they are in
    -- it: a link made by somebody who has since been removed should not keep
    -- announcing them.
    (
      select m.display_name_snapshot
      from public.circle_members m
      where m.circle_id = c.id and m.user_id = i.created_by and m.status = 'active'
    ),
    coalesce(
      (
        select array_agg(upper(left(m.display_name_snapshot, 1)) order by m.joined_at, m.user_id)
        from public.circle_members m
        where m.circle_id = c.id and m.status = 'active'
      ),
      '{}'
    )
  from public.circle_invites i
  join public.circles c on c.id = i.circle_id
  where i.secret_hash = p_secret_hash
    and i.revoked_at is null
    and c.status = 'active';
$$;

comment on function public.invite_preview(bytea) is
  'The Join page before joining: circle name, inviter name and one initial per member, by invite digest. No row for a revoked or unknown invite or an archived circle.';

revoke all on function public.invite_preview(bytea) from public;
grant execute on function public.invite_preview(bytea) to anon, authenticated;
