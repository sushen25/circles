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
  removed boolean := false;
begin
  select * into token
  from private.email_action_tokens t
  where t.token_hash = p_token_hash and t.purpose = 'prefs' and t.expires_at > now();

  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  if p_action = 'stop_plan' then
    -- Immediately, and only this plan's. "Stop emails for this meetup" is the
    -- narrow one, offered in every event email beside the broader link.
    update private.email_subscriptions s
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where s.contact_id = token.contact_id
      and s.plan_id = p_plan_id
      and s.status = 'active';

  elsif p_action = 'remove_contact' then
    update private.email_subscriptions s
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where s.contact_id = token.contact_id and s.status = 'active';

    -- Suppressed by the address's own request, which is what `unsubscribed`
    -- means here: recorded by hash in a table nothing deletes from, so the
    -- promise survives the contact row being purged by retention — and so that
    -- somebody re-adding the address later cannot restart the email for them.
    update private.email_contacts c
    set status = 'suppressed',
        suppressed_at = now(),
        suppression_reason = 'unsubscribed',
        updated_at = now()
    where c.id = token.contact_id and c.status <> 'suppressed';

    insert into private.email_suppressions (email_hash, reason)
    select c.email_hash, 'unsubscribed' from private.email_contacts c where c.id = token.contact_id
    on conflict (email_hash) do nothing;

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
            'active', s.status = 'active'
          )
          order by p.window_start desc, s.plan_id
        ),
        '[]'::jsonb
      )
      from private.email_subscriptions s
      join public.plans p on p.id = s.plan_id
      join public.circles ci on ci.id = p.circle_id
      where s.contact_id = token.contact_id
    )
  );
end;
$$;

comment on function public.email_preferences(bytea, text, uuid) is
  'Reads or withdraws one contact''s plan-update subscriptions from a long-lived prefs token, with no sign-in. Removing the contact suppresses the address by hash, permanently. Service role only.';

revoke all on function public.email_preferences(bytea, text, uuid) from public;
revoke all on function public.email_preferences(bytea, text, uuid) from anon, authenticated;
grant execute on function public.email_preferences(bytea, text, uuid) to service_role;
