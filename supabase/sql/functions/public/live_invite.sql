-- ---------------------------------------------------------------------------
-- The circle's live invite, as any active member may know it (S1-23, ADR 0028;
-- widened from the owner alone by SUS-248, Sushen's decision of 23 Oct 2026).
--
-- `get-invite-link` shows a member the link again. The secret is not stored
-- — only its SHA-256 is (§14) — so the Edge Function *derives* it from the
-- invite's id with a key the database never sees, and checks the derivation
-- against the digest before handing anything back. This is the half the
-- database can answer: which invite is live, and what its digest is.
--
-- Any active member's, guests included: the invitation already reaches every
-- member who reads the group chat, so this changes who can share it again, not
-- who can see it. Making a new invite and cutting off old ones stay the owner's
-- (`issue_invite`, `rotate-invite`). Anyone who is not an active member of this
-- circle (removed, left, or in another circle) is refused rather than answered
-- with nothing, so the screen can tell "you may not" from "there is no link".
--
-- **The service role's, not the client's (SUS-114).** The digest is not the
-- secret, but it was a way in, and an owner's client has no use for it:
-- only `get-invite-link` compares it. So that function calls this with the
-- member it verified from the JWT as `p_user_id`, and the digest stops at the
-- server.
--
-- No row when the circle has no live invite: a circle made without one (the
-- fixtures do that) has nothing to show until the owner resets it.
-- ---------------------------------------------------------------------------

create or replace function public.live_invite(p_circle_id uuid, p_user_id uuid)
returns table (invite_id uuid, secret_hash bytea)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'live_invite requires a member asking'
      using errcode = 'insufficient_privilege';
  end if;

  -- An *active* member of this circle: someone who has left or been removed is
  -- refused, and an id that is not a circle is simply not theirs.
  if not exists (
    select 1
    from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'not_a_member' using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.secret_hash
    from public.circle_invites i
    where i.circle_id = p_circle_id and i.revoked_at is null;
end;
$$;

comment on function public.live_invite(uuid, uuid) is
  'The id and digest of a circle''s live invite, if p_user_id is an active member of the circle, so get-invite-link can re-derive the secret (ADR 0028). Never the secret: the database does not have it. Service role only: the digest does not reach a client (SUS-114).';

revoke all on function public.live_invite(uuid, uuid) from public;
revoke all on function public.live_invite(uuid, uuid) from anon, authenticated;
grant execute on function public.live_invite(uuid, uuid) to service_role;
