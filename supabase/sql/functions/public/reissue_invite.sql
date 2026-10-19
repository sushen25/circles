-- ---------------------------------------------------------------------------
-- The service role's way to reissue a circle's invite (SUS-125).
--
-- "The invite key has leaked" (`docs/runbooks/environments.md`): every live
-- invite secret was derived from `INVITE_LINK_KEY`, so rotating the key alone
-- only makes the links unshowable; the old ones keep opening their circles.
-- `scripts/rotate-invite-key.mjs` derives a fresh secret under the new key for
-- every circle and calls this to swap it in. `issue_invite` cannot do that: it
-- is the owner's alone and reads `auth.uid()`, and there are thousands of
-- owners and one operator.
--
-- It names the invite it replaces and does nothing, returning false, if that
-- one is no longer live (an owner reset the link while the sweep ran).
--
-- Like `issue_invite` it takes a digest and never a secret, so the database
-- learns nothing it did not know. The old link is revoked in the same
-- statement as the new one is inserted, so there is no moment with two live
-- links (`circle_invites_one_live_idx`) or none.
--
-- **Not callable by a client.** Granted to `service_role` alone; the audit row
-- has no actor, which is how a reader tells an operator's rotation from an
-- owner's. No `circles.invite_rotated` event: the owner did nothing and has
-- nothing to be told; their next look at the link shows the new one.
-- ---------------------------------------------------------------------------

create or replace function public.reissue_invite(
  p_circle_id uuid,
  p_secret_hash bytea,
  p_invite_id uuid,
  p_replaces uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  issued public.circle_invites;
  revoked integer;
begin
  select c.owner_user_id into owner from public.circles c where c.id = p_circle_id;
  if not found then
    raise exception 'circle_not_found' using errcode = 'no_data_found';
  end if;

  -- Only the invite the sweep saw. If the owner reset the link between the
  -- read and this call, the live one is already theirs and already under the
  -- new key: revoking it would kill a link they may have just shared.
  update public.circle_invites i
  set revoked_at = now()
  where i.id = p_replaces and i.circle_id = p_circle_id and i.revoked_at is null;
  get diagnostics revoked = row_count;
  if revoked = 0 then
    return false;
  end if;

  -- Always an HMAC: the sweep computes it under the project's digest key (ADR 0081).
  insert into public.circle_invites (id, circle_id, secret_hash, digest_kind, created_by)
  values (p_invite_id, p_circle_id, p_secret_hash, 'hmac', owner)
  returning * into issued;

  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (null, 'circles.invite_reissued', 'circle', p_circle_id,
          jsonb_build_object('invite_id', issued.id));

  return true;
end;
$$;

comment on function public.reissue_invite(uuid, bytea, uuid, uuid) is
  'Replaces a circle''s live invite with one the service role derived under a new key, revoking the old. For the "invite key has leaked" runbook; service_role only.';

revoke all on function public.reissue_invite(uuid, bytea, uuid, uuid) from public;
revoke all on function public.reissue_invite(uuid, bytea, uuid, uuid) from anon, authenticated;
grant execute on function public.reissue_invite(uuid, bytea, uuid, uuid) to service_role;
