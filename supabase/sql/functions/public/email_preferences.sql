-- ---------------------------------------------------------------------------
-- Stopping the email, without signing in.
--
-- The Spam Act's unsubscribe, answered in one tap, for somebody who may have no
-- account and no memory of the circle (spec §5.8, §13). The token is long-lived
-- — a link in an email from three months ago still has to work — and, unlike
-- the verification one, is **not** consumed: an unsubscribe link that worked
-- once and then expired would be an unsubscribe link that does not work.
--
-- What it can reach is one contact's own subscriptions and nothing else. It
-- names the circle and the plan because an unauthenticated page cannot ask
-- somebody to choose between two uuids, and those two names are what the email
-- that carried this link already told this reader. No member names, no
-- addresses, no quiet-ask state.
--
-- `remove_contact` deletes the contact rather than marking it: the address is
-- the private thing, and "remove" has to mean the address is gone. What stays
-- is the hash in `email_suppressions`, which is what makes the promise
-- permanent — a contact created for that address later arrives suppressed.
--
-- **Every contact holding that address, not only this one.** Suppression has
-- crossed the siblings since 0009, and retention "deliberately does not delete
-- suppressed contacts" — so deleting one row and suppressing the rest left the
-- plaintext sitting in a sibling for ever, which is the thing the link promised
-- to undo. The siblings are already unreachable by then; what was left was the
-- address and nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.email_preferences(
  p_token_hash bytea,
  p_action text,
  p_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token private.email_action_tokens;
  owner private.email_contacts;
  stopped private.email_subscriptions;
  removed boolean := false;
begin
  select * into token
  from private.email_action_tokens t
  where t.token_hash = p_token_hash and t.purpose = 'prefs' and t.expires_at > now();

  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  select * into owner from private.email_contacts c where c.id = token.contact_id;

  if p_action = 'stop_plan' then
    -- Immediately, and only this plan's. "Stop emails for this meetup" is the
    -- narrow one, offered in every event email beside the broader link.
    update private.email_subscriptions s
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where s.contact_id = token.contact_id
      and s.plan_id = p_plan_id
      and s.status = 'active'
    returning * into stopped;

    if stopped.id is not null then
      perform jobs.emit('communication.subscription_changed', 'subscription', stopped.id,
        jsonb_build_object(
          'subscription_id', stopped.id,
          'contact_id', stopped.contact_id,
          'plan_id', stopped.plan_id,
          'status', 'withdrawn'
        ));
    end if;

  elsif p_action = 'remove_contact' then
    -- Withdrawn across the address, one row at a time so that every consent
    -- ending has an event of its own: a subscription that vanished with its
    -- contact and told nothing downstream is a consent record that stops
    -- without a reason attached to it.
    for stopped in
      update private.email_subscriptions s
      set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
      from private.email_contacts c
      where c.id = s.contact_id
        and c.email_hash = owner.email_hash
        and s.status = 'active'
      returning s.*
    loop
      perform jobs.emit('communication.subscription_changed', 'subscription', stopped.id,
        jsonb_build_object(
          'subscription_id', stopped.id,
          'contact_id', stopped.contact_id,
          'plan_id', stopped.plan_id,
          'status', 'withdrawn'
        ));
    end loop;

    -- Suppressed first, because that is what writes the tombstone: the
    -- `record_suppression` trigger records the hash in a table nothing deletes
    -- from. Doing the insert here by hand would be the same rule written twice.
    update private.email_contacts c
    set status = 'suppressed',
        suppressed_at = now(),
        suppression_reason = 'unsubscribed',
        verified_at = null,
        updated_at = now()
    where c.email_hash = owner.email_hash and c.status <> 'suppressed';

    -- And then the address itself goes, from every row that held it. "Remove"
    -- is what the link says and what §14 promises — "purges private data" — so
    -- leaving the plaintext in a sibling's `email_normalized` for ever because
    -- that row is merely marked suppressed would be answering a different
    -- request, and retention never comes for a suppressed contact. The
    -- tombstone is a hash and survives; so does the promise it carries, because
    -- a contact inserted for that address later arrives suppressed.
    --
    -- The cascade takes the subscriptions, the tokens — including this one, so
    -- the link stops working, which is the honest state — and any queued email.
    -- Somebody who asked to be forgotten should not receive tomorrow's reminder.
    delete from private.email_contacts c where c.email_hash = owner.email_hash;

    removed := true;

  elsif p_action <> 'view' then
    raise exception 'unknown_preference_action' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'removed', removed,
    'subscriptions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'plan_id', s.plan_id,
            'plan_title', p.title,
            'circle_name', ci.name,
            -- Active means "will actually be emailed", which is the
            -- question the page is answering. A subscription left active
            -- under a contact that bounced, or that a sibling had removed,
            -- would show as on while `email_recipients_for` skips it.
            'active', s.status = 'active' and c.status = 'verified'
          )
          order by p.window_start desc, s.plan_id
        ),
        '[]'::jsonb
      )
      from private.email_subscriptions s
      join private.email_contacts c on c.id = s.contact_id
      join public.plans p on p.id = s.plan_id
      join public.circles ci on ci.id = p.circle_id
      where s.contact_id = token.contact_id
    )
  );
end;
$$;

comment on function public.email_preferences(bytea, text, uuid) is
  'Reads or withdraws one contact''s plan-update subscriptions from a long-lived prefs token, with no sign-in. Removing suppresses the address by hash, permanently, and deletes every contact that held it. Service role only.';

revoke all on function public.email_preferences(bytea, text, uuid) from public;
revoke all on function public.email_preferences(bytea, text, uuid) from anon, authenticated;
grant execute on function public.email_preferences(bytea, text, uuid) to service_role;
