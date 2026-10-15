-- ---------------------------------------------------------------------------
-- The stop link under an account-holder letter, minted when the letter is sent.
--
-- Every letter an account holder gets without having opted in carries a link
-- that stops that family of letters without a sign-in (ADR 0067 for the
-- cadence nudge, ADR 0069 for the rest). The token behind it is minted here by
-- the sender for the one letter it is going into, for the reason ADR 0020
-- gave for the others: a job row carries ids and no payload, and the token
-- table holds a digest, so a token minted earlier has no way to reach the
-- letter.
--
-- **One purpose per family of letters.** `nudge_stop` stops the cadence nudge,
-- `organiser_stop` stops the organiser's letters about a plan they run, and
-- `quiet_stop` stops the quiet ask's two letters to its initiator. A
-- preferences token (`prefs`) stops plan email and can remove an address; none
-- of these does. `stop_letters` accepts a token only for the family its link
-- was built for, so a link in one kind of letter cannot be used for another.
--
-- **Reusable, a year.** Tapping it does not spend it: a stop link that worked
-- once and then expired would not be one, and a letter may be read months
-- after it was sent. Retention removes each a week after it expires.
--
-- **Null is an ordinary answer**: a contact that is not verified, or is not
-- anybody's (`user_id` null — a plan-update contact of a guest who never signed
-- in has no account to stop letters for), is not somebody these letters should
-- be going to. The sender skips the job. A purpose that is not one of the three
-- is a programming error and raises. Service role only; the Edge Function
-- passes the digest, so the readable token is never a statement parameter
-- (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_stop_token(
  p_contact_id uuid,
  p_purpose text,
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
  if p_purpose is null or p_purpose not in ('nudge_stop', 'organiser_stop', 'quiet_stop') then
    raise exception 'invalid_stop_purpose' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from private.email_contacts c
    where c.id = p_contact_id and c.status = 'verified' and c.user_id is not null
  ) then
    return null;
  end if;

  insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
  values (p_contact_id, p_purpose, p_token_hash, now() + interval '365 days')
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_stop_token(uuid, text, bytea) is
  'Stores the digest of a one-year reusable stop token (nudge_stop, organiser_stop or quiet_stop) for one verified contact that belongs to a user, for the email being sent. Null otherwise, which the sender treats as a skipped job. Service role only (ADR 0067, ADR 0069).';

revoke all on function public.issue_stop_token(uuid, text, bytea) from public;
revoke all on function public.issue_stop_token(uuid, text, bytea) from anon, authenticated;
grant execute on function public.issue_stop_token(uuid, text, bytea) to service_role;
