-- ---------------------------------------------------------------------------
-- The link under every plan-update email, minted when the email is sent.
--
-- "Stop emails for this meetup" and "Manage email preferences" both open
-- `/e#<token>` (ADR 0023), and the token behind them is minted here by the
-- sender for the one letter it is going into — the rule ADR 0020 set for the
-- verification token, and for the same reason: a job row carries ids and no
-- payload, so a token minted anywhere earlier has no way to reach the letter.
--
-- **One per email, reusable, ninety days** (ADR 0019): tapping it does not
-- spend it, because an unsubscribe that worked once and then broke would not
-- be one. ADR 00XX records why it is one per email rather than one per contact:
-- the readable token is never stored, so an existing one cannot be put into a
-- second letter. Retention removes each a week after it expires.
--
-- **Null is an ordinary answer**, as it is for `issue_verification_token`: a
-- contact that is not verified — suppressed by a bounce since the job was
-- queued, or removed by its owner — is not somebody the dispatcher should be
-- mailing, and the job is skipped rather than retried. The dispatcher's own
-- eligibility read (`private.email_recipients_for`) should already have said
-- so; this is the second place that refuses, not the first.
--
-- Service role only. The Edge Function mints the token and passes the digest,
-- so the readable form is never a statement parameter (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_preferences_token(
  p_contact_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_id uuid;
begin
  if not exists (
    select 1 from private.email_contacts c where c.id = p_contact_id and c.status = 'verified'
  ) then
    return null;
  end if;

  insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
  values (p_contact_id, 'prefs', p_token_hash, now() + interval '90 days')
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_preferences_token(uuid, bytea) is
  'Stores the digest of a ninety-day reusable preferences token for one verified contact, for the email being sent. Null when the contact is not verified, which the sender treats as a skipped job. The token itself is minted in the Edge Function. Service role only.';

revoke all on function public.issue_preferences_token(uuid, bytea) from public;
revoke all on function public.issue_preferences_token(uuid, bytea) from anon, authenticated;
grant execute on function public.issue_preferences_token(uuid, bytea) to service_role;
