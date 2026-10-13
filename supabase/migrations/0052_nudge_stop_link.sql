-- 0052_nudge_stop_link
--
-- Every cadence nudge carries a stop link that needs no sign-in (SUS-190,
-- ADR 0067).
--
--   * email_action_tokens gains a fourth purpose, `nudge_stop`: the token under
--     an about_time email. It is reusable and lasts a year, and carries no
--     membership (the same shape as `prefs`);
--   * public.issue_nudge_stop_token mints it, for a verified contact that
--     belongs to a user;
--   * public.stop_nudges spends nothing and turns off
--     circle_members.muted_nudges for the token's owner, in every circle they
--     are active in, and skips their queued nudges.
-- Existing rows are untouched.

alter table private.email_action_tokens drop constraint email_action_tokens_purpose;
alter table private.email_action_tokens
  add constraint email_action_tokens_purpose
  check (purpose in ('verify', 'prefs', 'reentry', 'nudge_stop'));

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/issue_nudge_stop_token.sql
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

-- supabase/sql/functions/public/stop_nudges.sql
-- ---------------------------------------------------------------------------
-- Stopping the cadence nudge, without signing in.
--
-- One tap on the link under an `about_time` email (ADR 0067). It turns off
-- "Nudges to plan the next one" (`circle_members.muted_nudges`, the switch on
-- notification settings, ADR 0029) for the person the token was minted for, in
-- every circle they are an active member of: someone who asks for the reminders
-- to stop has not asked for them to stop in one circle only, and the settings
-- screen turns any of them back on. `isNudgeable` already honours the flag.
--
-- **Scoped three ways.** The token's purpose must be `nudge_stop` (a plan-update
-- preferences token is refused, and so is a verification or re-entry one); the
-- person is the contact's owner and nobody else; and the only thing written is
-- that one flag. Not the address, not plan email, not organiser letters.
--
-- **Safe to repeat.** The token is not consumed and the update changes only
-- rows that are still unmuted, so a second tap, or a mail gateway that opens the
-- page and taps nothing, does no harm and changes nothing.
--
-- **Reveals nothing.** The answer is `{ "stopped": true }` and carries no name,
-- no circle, no address. A token that is unknown, expired or of another purpose
-- answers `link_expired`, the same for all three, so the endpoint does not say
-- which tokens exist.
--
-- A nudge already queued behind quiet hours is skipped (`nudge_stopped`), so
-- the letter in the queue does not arrive after the person said stop. Service
-- role only.
-- ---------------------------------------------------------------------------

create or replace function public.stop_nudges(p_token_hash bytea)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  owner private.email_contacts;
begin
  select c.* into owner
  from private.email_action_tokens t
  join private.email_contacts c on c.id = t.contact_id
  where t.token_hash = p_token_hash
    and t.purpose = 'nudge_stop'
    and t.expires_at > now()
    and c.user_id is not null;

  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  update public.circle_members m
  set muted_nudges = true
  where m.user_id = owner.user_id
    and m.status = 'active'
    and not m.muted_nudges;

  update jobs.notification_jobs j
  set status = 'skipped', last_error = 'nudge_stopped', updated_at = now()
  where j.kind = 'about_time'
    and j.channel = 'email'
    and j.status = 'scheduled'
    and j.contact_id in (
      select c.id from private.email_contacts c where c.user_id = owner.user_id
    );

  return jsonb_build_object('stopped', true);
end;
$$;

comment on function public.stop_nudges(bytea) is
  'Turns off the cadence nudge (circle_members.muted_nudges) for the owner of a nudge_stop token, in every circle they are active in, and skips their queued nudges. The token is not consumed; the answer reveals nothing. link_expired for an unknown, expired or other-purpose token. Service role only (ADR 0067).';

revoke all on function public.stop_nudges(bytea) from public;
revoke all on function public.stop_nudges(bytea) from anon, authenticated;
grant execute on function public.stop_nudges(bytea) to service_role;

-- END GENERATED: function definitions
