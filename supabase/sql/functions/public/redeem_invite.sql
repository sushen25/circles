-- ---------------------------------------------------------------------------
-- redeem_invite
--
-- The only way a membership is created from an invite link (§9.1). A definer
-- function rather than an insert policy, for the reason `create_circle` is
-- one: joining is several writes that have to be one — the membership, the use
-- count, and two checks that are only true if nobody else joins between them.
--
-- **The secret never arrives here.** The Edge Function hashes the link
-- fragment with SHA-256 and passes the digest, so the capability itself is
-- never a statement parameter and cannot reach a query log (§14: tokens are
-- "never logged"). The digest finds the invite; the row it finds is the
-- authority.
--
-- **The service role's, and nobody else's (SUS-114).** The table keeps only the
-- SHA-256 of the secret, so if that digest were enough to call this, a copy of
-- `public.circle_invites` would be a set of working links into every circle,
-- which is what ADR 0028 chose to hash the secrets to avoid. So only the
-- `redeem-invite` Edge Function may call it, the way `join_from_plan` is
-- called: it passes the person it verified from the JWT as `p_user_id`, never
-- anything out of the request body, and the membership lands on that person.
--
-- What this function enforces is what the database would refuse whoever
-- asked: the invite must be live, the cap holds, the name must be free.
-- Turnstile and the per-address limit live in the Edge Function because they
-- are abuse controls rather than authorisation.
--
-- Idempotent by its own state rather than by a key column: being an active
-- member of the circle *is* the record that this already happened, so a retry
-- returns the circle and writes nothing. (`create_circle` carries a
-- `creation_key` because a circle has no such natural record — asking twice
-- would leave two circles and no way to tell which link was shared.)
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(
  p_user_id uuid,
  p_secret_hash bytea,
  p_display_name text
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := p_user_id;
  invite public.circle_invites;
  target public.circles;
begin
  if caller is null then
    raise exception 'redeem_invite requires the person joining'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds whatever the Edge Function did. Keyed on the person
  -- joining, `p_user_id`, which only the service role can name and which the
  -- Edge Function takes from the verified JWT: never on an id a client could
  -- choose, which would let anybody spend somebody else's allowance. Sized far
  -- above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'redeem_invite_sql', extensions.digest(caller::text, 'sha256'), 120, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  -- `invite_inactive` is one error for three causes — no such secret, revoked,
  -- or a circle that has since gone — because the caller is not entitled to
  -- know which. The LinkInvalid screen says the same thing to all three.
  select * into invite
  from public.circle_invites i
  where i.secret_hash = p_secret_hash and i.revoked_at is null;

  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- Serialises concurrent joins. `enforce_member_cap` takes the same lock, and
  -- taking it here too means the duplicate-name check and the cap see one
  -- roster rather than two.
  select * into target from public.circles c where c.id = invite.circle_id for update;
  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- The cap, the name and rejoining after removal are the same for every way
  -- into a circle, and live in `private.admit_member` so that they stay the
  -- same (ADR 0022 added a second way in). What is this function's own is the
  -- invite, and counting its use — once, and not for somebody who was already
  -- in: a retry, a second tap, or the link opened twice in one browser.
  if private.admit_member(target.id, caller, p_display_name) then
    update public.circle_invites i
    set use_count = i.use_count + 1
    where i.id = invite.id;
  end if;

  return target;
end;
$$;

comment on function public.redeem_invite(uuid, bytea, text) is
  'Joins p_user_id to the circle behind an invite digest. Idempotent on an existing active membership; raises invite_inactive, duplicate_name or circle_full. Service role only: the digest is stored, so it must not be a way in by itself, and the redeem-invite Edge Function that hashes the secret passes the caller it verified (SUS-114).';

revoke all on function public.redeem_invite(uuid, bytea, text) from public;
revoke all on function public.redeem_invite(uuid, bytea, text) from anon, authenticated;
grant execute on function public.redeem_invite(uuid, bytea, text) to service_role;
