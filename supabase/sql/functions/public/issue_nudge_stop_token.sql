-- ---------------------------------------------------------------------------
-- The stop link under a cadence nudge, minted when the nudge is sent.
--
-- Every `about_time` email carries a link that stops the nudge without a
-- sign-in (ADR 0067). The token behind it is minted here by the sender for the
-- one letter it is going into, for the reason ADR 0020 gave for the others: a
-- job row carries ids and no payload, and the token table holds a digest, so a
-- token minted earlier has no way to reach the letter.
--
-- **Its own purpose, `nudge_stop`.** A preferences token (`prefs`) stops plan
-- email and can remove an address; this one stops the cadence nudge and does
-- nothing else, so a link in one kind of letter cannot be used for the other.
-- `stop_nudges` refuses any other purpose.
--
-- **Reusable, a year.** Tapping it does not spend it: a stop link that worked
-- once and then expired would not be one, and a nudge may be read months after
-- it was sent. Retention removes each a week after it expires.
--
-- **Null is an ordinary answer**: a contact that is not verified, or is not
-- anybody's (`user_id` null — a plan-update contact of a guest who never signed
-- in has no circle to mute), is not somebody a nudge should be going to. The
-- sender skips the job. Service role only; the Edge Function passes the digest,
-- so the readable token is never a statement parameter (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_nudge_stop_token(
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
    select 1
    from private.email_contacts c
    where c.id = p_contact_id and c.status = 'verified' and c.user_id is not null
  ) then
    return null;
  end if;

  insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
  values (p_contact_id, 'nudge_stop', p_token_hash, now() + interval '365 days')
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_nudge_stop_token(uuid, bytea) is
  'Stores the digest of a one-year reusable stop-the-cadence-nudge token for one verified contact that belongs to a user, for the email being sent. Null otherwise, which the sender treats as a skipped job. Service role only (ADR 0067).';

revoke all on function public.issue_nudge_stop_token(uuid, bytea) from public;
revoke all on function public.issue_nudge_stop_token(uuid, bytea) from anon, authenticated;
grant execute on function public.issue_nudge_stop_token(uuid, bytea) to service_role;
