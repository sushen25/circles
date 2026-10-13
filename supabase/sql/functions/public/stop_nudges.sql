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
