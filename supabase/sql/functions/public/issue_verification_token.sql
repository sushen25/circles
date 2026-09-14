-- ---------------------------------------------------------------------------
-- The link that goes in the verification email, minted when the email is sent.
--
-- The readable token exists in two places and no others: the sender's memory
-- for the length of one send, and the letter itself (§14). That is only
-- possible if it is made at send time — a token minted when the person asked
-- would have to travel to the sender somehow, and every route is one this
-- repository has closed: `jobs.notification_jobs` carries ids and no payload,
-- `jobs.outbox` refuses a key called `token`, and the token table holds a
-- digest. ADR 0020 records the decision; `request_email_updates` writes the
-- job that brings the dispatcher here.
--
-- **Null is an ordinary answer.** By the time a queued `verify_email` is
-- drained, the contact may have been verified by another link, suppressed by a
-- bounce, or removed by its owner. None of those is a failure the sender should
-- retry — the job is simply skipped — and an exception for each would make a
-- routine outcome look like a fault.
--
-- "Resend invalidates the previous token" (spec §5.8) lives here now, because
-- here is where a token starts existing. Spent rather than deleted, so somebody
-- clicking the older link is told it is used rather than that it never was.
-- ---------------------------------------------------------------------------

create or replace function public.issue_verification_token(
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
  -- Locked, because two dispatcher workers draining two jobs for one contact
  -- would otherwise each spend the other's token and send two letters of which
  -- only the later works.
  select * into contact from private.email_contacts c where c.id = p_contact_id for update;

  if not found or contact.status <> 'pending' then
    return null;
  end if;

  update private.email_action_tokens t
  set used_at = now()
  where t.contact_id = p_contact_id and t.purpose = 'verify' and t.used_at is null;

  insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
  values (p_contact_id, 'verify', p_token_hash, now() + interval '24 hours')
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_verification_token(uuid, bytea) is
  'Stores the digest of a 24-hour single-use verification token and spends the contact''s previous ones. Null when there is nothing left to verify, which the sender treats as a skipped job. The token itself is minted in the Edge Function. Service role only.';

revoke all on function public.issue_verification_token(uuid, bytea) from public;
revoke all on function public.issue_verification_token(uuid, bytea) from anon, authenticated;
grant execute on function public.issue_verification_token(uuid, bytea) to service_role;
