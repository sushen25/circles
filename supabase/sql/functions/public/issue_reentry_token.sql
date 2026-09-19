-- ---------------------------------------------------------------------------
-- The single-use way back into a circle, for a guest with no session.
--
-- Every event email carries one (spec §5.8, §5.11): "a guest returns with no
-- session" is the most common real thing that happens (§9), and without this
-- their only way back is a link somebody else has to resend. Seven days,
-- single-use, and consumed by `reattach-member` (S1-13), which moves the
-- membership onto whatever identity the browser has now.
--
-- **Null for a saved-place identity**, because that is not a fault. Every event
-- email carries a re-entry link and permanent members get event email too; the
-- template simply leaves the link out for somebody who can sign in. Reaching
-- the table's own guard instead — `enforce_reentry_for_guests`, which raises
-- `check_violation` — turned an ordinary rendering decision into a SQLSTATE
-- nothing can translate and a 500 for the reader. The trigger stays: it is the
-- rule, and this is the answer the one caller needs. A sign-in bypass is still
-- impossible, now twice over.
--
-- **For the contact the letter is going to** (S1-19). It used to take the
-- user and hang the token on their most recently verified contact, which is
-- not necessarily the address the email is for: somebody with two verified
-- addresses who later removed the first had the cascade take the re-entry
-- links out of letters sent to the second. The dispatcher knows exactly which
-- contact it is writing to — the job names it — so it says so, and the user is
-- the contact's owner.
--
-- Service role only. It mints nothing itself — the Edge Function generates the
-- token and passes the digest, so the readable form is never a statement
-- parameter and never reaches a query log (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_reentry_token(
  p_circle_id uuid,
  p_contact_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact private.email_contacts;
  token_id uuid;
begin
  -- A verified one: a re-entry link travels in an email, and an email goes
  -- only to an address that proved itself.
  select * into contact from private.email_contacts c where c.id = p_contact_id;

  if not found or contact.status <> 'verified' then
    raise exception 'no_verified_contact' using errcode = 'P0001';
  end if;

  -- Somebody who signs in needs no way back, so there is nothing to issue and
  -- nothing has gone wrong. Checked before the membership, because a permanent
  -- identity's membership is beside the point.
  if exists (
    select 1 from public.profiles pr where pr.user_id = contact.user_id and pr.is_permanent
  ) then
    return null;
  end if;

  -- The membership has to be one. A token for a circle this person is not in
  -- would be a link back into somebody else's circle, and the foreign key that
  -- would have caught it raises a SQLSTATE nothing can translate — a 500 for an
  -- ordinary mistake.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = contact.user_id and m.status = 'active'
  ) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  insert into private.email_action_tokens (
    contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
  )
  values (
    contact.id, 'reentry', p_token_hash, now() + interval '7 days', p_circle_id, contact.user_id
  )
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_reentry_token(uuid, uuid, bytea) is
  'Stores the digest of a seven-day single-use re-entry token for the guest membership of one verified contact''s owner, and returns null for a saved-place identity, which needs no link. The token itself is minted in the Edge Function and never reaches the database. Service role only.';

revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from public;
revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.issue_reentry_token(uuid, uuid, bytea) to service_role;
