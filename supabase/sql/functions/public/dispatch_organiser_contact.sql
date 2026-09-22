-- ---------------------------------------------------------------------------
-- The organiser's auth email, as something that can be sent to.
--
-- Spec §5.8 sends the organiser kinds — options ready, replies closed, did it
-- happen, about time — to "the signed-in organiser" by email until they
-- install the app. `jobs.notification_jobs` cannot address a person: the email
-- channel takes a `contact_id` and no `user_id` (`notification_jobs_recipient`,
-- S1-11 round 5), and the delivery webhook suppresses by contact and by
-- address hash. An organiser with no contact row is an organiser the pipeline
-- has no way to write to, and no way to stop writing to after a bounce.
--
-- So the auth address becomes an ordinary contact, and the suppression
-- machinery covers organiser mail exactly as it covers plan-update mail
-- (ADR 0027).
--
-- **Verified, because auth already verified it.** `email_contacts.status`
-- records whether we have proof this identity controls this address. A
-- verification link is one proof; `auth.users.email_confirmed_at` — set by the
-- sign-in code the person typed back — is the same proof, obtained earlier.
-- An address with no `email_confirmed_at` is not one of those, and gets
-- nothing here.
--
-- **No subscription is created.** A subscription is consent to plan-update
-- email, scoped to one plan, and this is not that (privacy invariant: "plan
-- update email consent is scoped to one plan and is never marketing consent").
-- The organiser kinds carry `emailNeedsSubscription: false` in the domain's
-- table and need none.
--
-- **Suppressed stays suppressed**, and returns null: `apply_suppression` marks
-- a contact created for a tombstoned address on the way in, so a bounce that
-- happened to a plan-update letter also stops the organiser mail.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_organiser_contact(p_user_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  address text;
  contact private.email_contacts;
begin
  select lower(btrim(u.email)) into address
  from auth.users u
  where u.id = p_user_id
    and u.email_confirmed_at is not null
    and not coalesce(u.is_anonymous, false);

  -- A guest has no address of ours to write to, and a saved place that has not
  -- confirmed one has not proven it. Neither is a failure: it is an organiser
  -- with no reachable channel, which the domain already calls silence.
  if address is null or address !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return null;
  end if;

  select * into contact
  from private.email_contacts c
  where c.user_id = p_user_id
    and c.email_hash = extensions.digest(address, 'sha256');

  if not found then
    insert into private.email_contacts (user_id, email_normalized, status, verified_at)
    values (p_user_id, address, 'verified', now())
    returning * into contact;
  elsif contact.status = 'pending' then
    -- The same address, the same identity, and auth has confirmed it. Leaving
    -- it pending would silence the organiser because they once typed their own
    -- address into a plan's "email me updates" and never opened the letter.
    update private.email_contacts c
    set status = 'verified', verified_at = coalesce(c.verified_at, now()), updated_at = now()
    where c.id = contact.id
    returning * into contact;
  end if;

  if contact.status <> 'verified' then
    return null;
  end if;

  return contact.id;
end;
$$;

comment on function public.dispatch_organiser_contact(uuid) is
  'The email contact for an organiser''s confirmed auth address, created verified if absent. Null for a guest, an unconfirmed address or a suppressed one. Creates no subscription. Service role only (ADR 0027, S1-20).';

revoke all on function public.dispatch_organiser_contact(uuid) from public;
revoke all on function public.dispatch_organiser_contact(uuid) from anon, authenticated;
grant execute on function public.dispatch_organiser_contact(uuid) to service_role;
