-- ---------------------------------------------------------------------------
-- The circle's live invite, as its owner may know it (S1-23, ADR 0028).
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
-- **The service role's, not the client's (SUS-114).** The digest is not the
-- secret, but it was a way in, and an owner's client has no use for it:
-- only `get-invite-link` compares it. So that function calls this with the
-- owner it verified from the JWT as `p_user_id`, and the digest stops at the
-- server. (The owner check is `auth_is_owner`'s, restated for a caller who is
-- an argument rather than `auth.uid()`.)
--
-- **Which kind of digest it is** (SUS-214, ADR 0082): an invite made after the
-- change is an HMAC under `INVITE_DIGEST_KEY`, one made before is a plain
-- SHA-256, and `get-invite-link` compares the one that matches.
--
-- No row when the circle has no live invite: a circle made without one (the
-- fixtures do that) has nothing to show until the owner resets it.
-- ---------------------------------------------------------------------------

create or replace function public.live_invite(p_circle_id uuid, p_user_id uuid)
returns table (invite_id uuid, secret_hash bytea, digest_kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'live_invite requires the owner asking'
      using errcode = 'insufficient_privilege';
  end if;

  -- As `auth_is_owner`, this asks for an *active* owner: an owner who has left owns
  -- nothing, and an id that is not a circle is simply not theirs.
  if not exists (
    select 1
    from public.circles c
    join public.circle_members m
      on m.circle_id = c.id and m.user_id = c.owner_user_id and m.status = 'active'
    where c.id = p_circle_id and c.owner_user_id = p_user_id
  ) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.secret_hash, i.digest_kind
    from public.circle_invites i
    where i.circle_id = p_circle_id and i.revoked_at is null;
end;
$$;

comment on function public.live_invite(uuid, uuid) is
  'The id, digest and digest kind of a circle''s live invite, if p_user_id owns the circle, so get-invite-link can re-derive the secret (ADR 0028). Never the secret: the database does not have it. Service role only: the digest does not reach a client (SUS-114).';

revoke all on function public.live_invite(uuid, uuid) from public;
revoke all on function public.live_invite(uuid, uuid) from anon, authenticated;
grant execute on function public.live_invite(uuid, uuid) to service_role;
