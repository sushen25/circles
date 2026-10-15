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
