-- ---------------------------------------------------------------------------
-- The single-use way back into a circle, for a guest with no session.
--
-- Every event email carries one (spec §5.8, §5.11): "a guest returns with no
-- session" is the most common real thing that happens (§9), and without this
-- their only way back is a link somebody else has to resend. Seven days,
-- single-use, and consumed by `reattach-member` (S1-13), which moves the
-- membership onto whatever identity the browser has now.
--
-- Refused for a saved-place identity, and not by this function: the trigger
-- `enforce_reentry_for_guests` does it, because a re-entry link for somebody
-- who signs in is a sign-in bypass, and that is a rule the table holds rather
-- than one each caller remembers.
--
-- Service role only. It mints nothing itself — the Edge Function generates the
-- token and passes the digest, so the readable form is never a statement
-- parameter and never reaches a query log (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_reentry_token(
  p_circle_id uuid,
  p_user_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_id uuid;
  token_id uuid;
begin
  -- The contact this belongs to: a re-entry link travels in an email, so there
  -- is one. Its owner and the membership's owner are the same person, which the
  -- table's own foreign key insists on as well.
  select c.id into contact_id
  from private.email_contacts c
  where c.user_id = p_user_id and c.status = 'verified'
  order by c.verified_at desc
  limit 1;

  if contact_id is null then
    raise exception 'no_verified_contact' using errcode = 'P0001';
  end if;

  insert into private.email_action_tokens (
    contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
  )
  values (contact_id, 'reentry', p_token_hash, now() + interval '7 days', p_circle_id, p_user_id)
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_reentry_token(uuid, uuid, bytea) is
  'Stores the digest of a seven-day single-use re-entry token for a guest membership. The token itself is minted in the Edge Function and never reaches the database. Service role only.';

revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from public;
revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.issue_reentry_token(uuid, uuid, bytea) to service_role;
