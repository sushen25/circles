-- ---------------------------------------------------------------------------
-- The circle's live invite, as its owner may know it (S1-23, ADR 00XX).
--
-- `get-invite-link` shows the owner their link again. The secret is not stored
-- — only its SHA-256 is (§14) — so the Edge Function *derives* it from the
-- invite's id with a key the database never sees, and checks the derivation
-- against the digest before handing anything back. This is the half the
-- database can answer: which invite is live, and what its digest is.
--
-- The owner's alone, by the rule `issue_invite` follows: handing out the way
-- in is the one circle decision spec §5.2 gives to the owner. A member who is
-- not the owner is refused rather than answered with nothing, so the screen can
-- tell "you may not" from "there is no link".
--
-- The digest reaches its owner. That is not the secret, and nothing accepts it
-- in place of one: `redeem_invite` and `invite_preview` hash what they are
-- given, so a digest presented as a secret is a digest of a digest. It is
-- returned because comparing it here instead would mean the Edge Function
-- sending the derived secret's digest back in, which is the same comparison
-- with one more round trip.
--
-- No row when the circle has no live invite: a circle made without one (the
-- fixtures do that) has nothing to show until the owner resets it.
-- ---------------------------------------------------------------------------

create or replace function public.live_invite(p_circle_id uuid)
returns table (invite_id uuid, secret_hash bytea)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'live_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- `auth_is_owner` asks for an *active* owner: an owner who has left owns
  -- nothing, and an id that is not a circle is simply not theirs.
  if not public.auth_is_owner(p_circle_id) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.secret_hash
    from public.circle_invites i
    where i.circle_id = p_circle_id and i.revoked_at is null;
end;
$$;

comment on function public.live_invite(uuid) is
  'The id and digest of a circle''s live invite, for its owner, so get-invite-link can re-derive the secret (ADR 00XX). Never the secret: the database does not have it.';

revoke all on function public.live_invite(uuid) from public;
revoke all on function public.live_invite(uuid) from anon, authenticated;
grant execute on function public.live_invite(uuid) to authenticated;
