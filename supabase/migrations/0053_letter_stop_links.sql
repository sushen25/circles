-- 0053_letter_stop_links
--
-- Every account-holder letter carries a stop link that needs no sign-in
-- (SUS-110, ADR 0069), built on the cadence nudge's (SUS-190, ADR 0067).
--
--   * email_action_tokens gains two purposes beside `nudge_stop`:
--     `organiser_stop` (the organiser's letters about a plan they run) and
--     `quiet_stop` (the quiet ask's two letters to its initiator). Same shape
--     as `nudge_stop`: reusable, a year, no membership;
--   * public.issue_stop_token replaces issue_nudge_stop_token and mints a token
--     of any of the three purposes, for a verified contact that belongs to a
--     user;
--   * public.stop_letters replaces stop_nudges. It takes the token and the
--     family it was built for, spends nothing, and writes the flag the settings
--     screen writes: circle_members.muted_nudges, profiles.muted_organiser_email
--     or circle_members.muted_quiet_asks. No new flag.
-- Existing rows are untouched; tokens already minted under `nudge_stop` keep
-- working through the `nudges` family.

alter table private.email_action_tokens drop constraint email_action_tokens_purpose;
alter table private.email_action_tokens
  add constraint email_action_tokens_purpose
  check (purpose in ('verify', 'prefs', 'reentry', 'nudge_stop', 'organiser_stop', 'quiet_stop'));

drop function public.issue_nudge_stop_token(uuid, bytea);
drop function public.stop_nudges(bytea);

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/issue_stop_token.sql
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

-- supabase/sql/functions/public/stop_letters.sql
-- ---------------------------------------------------------------------------
-- Stopping a family of account-holder letters, without signing in.
--
-- One tap on the link under such a letter (ADR 0067, ADR 0069). The family says
-- what is stopped, and it writes the flag the settings screen writes for it:
--
--   * `nudges`    — the cadence nudge. `circle_members.muted_nudges` ("Nudges to
--                   plan the next one", ADR 0029), in every circle the person
--                   is an active member of: someone who asks for the reminders
--                   to stop has not asked for them to stop in one circle only.
--   * `organiser` — the letters about a plan the person organises
--                   (`options_ready`, `replies_closed`, `did_it_happen`).
--                   `profiles.muted_organiser_email` ("Emails about plans you
--                   organise"), the person's own row.
--   * `quiet`     — the quiet ask's two letters to its initiator
--                   (`threshold_initiator`, `quiet_expired`).
--                   `circle_members.muted_quiet_asks` ("Quiet asks"), in every
--                   circle the person is an active member of, for the same
--                   reason as the nudge.
--
-- **Scoped three ways.** The token's purpose must be the one the family names
-- (a token for one family is refused by the other two, a plan-update
-- preferences token by all three, and a verification or re-entry token too);
-- the person is the contact's owner and nobody else; and the only thing written
-- is that family's flag. Not the address, not plan email, not another family.
--
-- **Safe to repeat.** The token is not consumed and each update changes only
-- rows that are still unmuted, so a second tap, or a mail gateway that opens
-- the page and taps nothing, does no harm and changes nothing.
--
-- **Reveals nothing.** The answer is `{ "stopped": true }` and carries no name,
-- no circle, no address. A token that is unknown, tampered, expired, of another
-- family or of another purpose answers `link_expired`, the same for all of
-- them, so the endpoint does not say which tokens exist.
--
-- A letter of that family already queued (behind quiet hours) is skipped, so
-- the letter in the queue does not arrive after the person said stop. Service
-- role only.
-- ---------------------------------------------------------------------------

create or replace function public.stop_letters(p_token_hash bytea, p_family text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wanted text;
  owner private.email_contacts;
begin
  wanted := case p_family
    when 'nudges' then 'nudge_stop'
    when 'organiser' then 'organiser_stop'
    when 'quiet' then 'quiet_stop'
  end;

  select c.* into owner
  from private.email_action_tokens t
  join private.email_contacts c on c.id = t.contact_id
  where wanted is not null
    and t.token_hash = p_token_hash
    and t.purpose = wanted
    and t.expires_at > now()
    and c.user_id is not null;

  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  if p_family = 'nudges' then
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
  elsif p_family = 'organiser' then
    update public.profiles p
    set muted_organiser_email = true
    where p.user_id = owner.user_id
      and not p.muted_organiser_email;

    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'organiser_email_off', updated_at = now()
    where j.kind in ('options_ready', 'replies_closed', 'did_it_happen')
      and j.channel = 'email'
      and j.status = 'scheduled'
      and j.contact_id in (
        select c.id from private.email_contacts c where c.user_id = owner.user_id
      );
  else
    update public.circle_members m
    set muted_quiet_asks = true
    where m.user_id = owner.user_id
      and m.status = 'active'
      and not m.muted_quiet_asks;

    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'quiet_asks_muted', updated_at = now()
    where j.kind in ('threshold_initiator', 'quiet_expired')
      and j.channel = 'email'
      and j.status = 'scheduled'
      and j.contact_id in (
        select c.id from private.email_contacts c where c.user_id = owner.user_id
      );
  end if;

  return jsonb_build_object('stopped', true);
end;
$$;

comment on function public.stop_letters(bytea, text) is
  'Turns off one family of account-holder letters (nudges, organiser or quiet) for the owner of a stop token of that family, by writing the flag the settings screen writes, and skips their queued letters of that family. The token is not consumed; the answer reveals nothing. link_expired for an unknown, expired, other-family or other-purpose token. Service role only (ADR 0067, ADR 0069).';

revoke all on function public.stop_letters(bytea, text) from public;
revoke all on function public.stop_letters(bytea, text) from anon, authenticated;
grant execute on function public.stop_letters(bytea, text) to service_role;

-- END GENERATED: function definitions
