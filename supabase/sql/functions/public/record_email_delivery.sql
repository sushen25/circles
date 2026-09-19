-- ---------------------------------------------------------------------------
-- What the provider said about one message, and what follows from it.
--
-- Called by `email-provider-webhook` once the provider's signature has been
-- checked (architecture §13: "verify Svix signature; bounced/complained →
-- suppress contact immediately; store event once"). Everything here happens in
-- one transaction, so a webhook that fails half-way is retried whole rather
-- than leaving an event stored and its suppression undone.
--
-- **Stored once.** `(provider_message_id, event_type)` is unique, and a second
-- delivery of the same event — the provider retries until it sees a 2xx, and
-- a replayed request is the same event again — inserts nothing and does
-- nothing else. `recorded` says which it was.
--
-- **A hard bounce or a complaint suppresses the address, not the contact.**
-- Suppression is by `email_hash` everywhere else (0009, `email_preferences`),
-- and here too: every contact holding the address is suppressed — the
-- `record_suppression` trigger writes the tombstone and reaches the siblings —
-- every subscription at the address is withdrawn with an event of its own, and
-- every email still queued for it is skipped. The address comes from the
-- webhook's own `to`, hashed by the caller, so a bounce for a message whose
-- job has already been pruned (thirty days) still lands; the job's contact is
-- the fallback. When no contact holds the address any more the tombstone is
-- written directly, so it cannot be added back later and mailed again.
--
-- A soft bounce (`p_permanent` false) is stored and changes nothing: Resend
-- reports a transient failure as a bounce with `type: Transient`, and
-- suppressing somebody for a full mailbox would be permanent punishment for a
-- temporary state.
--
-- Returns ids only — the contact, the plan and its circle, for the caller's
-- log line and analytics event. Never the address.
-- ---------------------------------------------------------------------------

create or replace function public.record_email_delivery(
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_permanent boolean default true,
  p_email_hash bytea default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job jobs.notification_jobs;
  event_id uuid;
  target bytea;
  reason text;
  suppressed boolean := false;
  stopped private.email_subscriptions;
begin
  if p_event_type not in ('sent', 'delivered', 'bounced', 'complained', 'deferred', 'failed') then
    raise exception 'unknown_delivery_event' using errcode = 'P0001';
  end if;

  -- The job this message was sent for, when the dispatcher has recorded it.
  select * into job
  from jobs.notification_jobs j
  where j.provider_message_id = p_provider_message_id and j.channel = 'email'
  order by j.created_at desc
  limit 1;

  insert into private.email_delivery_events (
    job_id, provider_message_id, event_type, provider_occurred_at
  )
  values (job.id, p_provider_message_id, p_event_type, p_occurred_at)
  on conflict (provider_message_id, event_type) do nothing
  returning id into event_id;

  if event_id is null then
    -- Already stored: a retry or a replay. Whatever it caused has happened.
    return jsonb_build_object(
      'recorded', false,
      'suppressed', false,
      'contact_id', job.contact_id,
      'plan_id', job.plan_id,
      'circle_id', (select p.circle_id from public.plans p where p.id = job.plan_id)
    );
  end if;

  if p_event_type = 'complained' or (p_event_type = 'bounced' and p_permanent) then
    reason := case p_event_type when 'complained' then 'complained' else 'bounced' end;
    target := coalesce(
      p_email_hash,
      (select c.email_hash from private.email_contacts c where c.id = job.contact_id)
    );

    if target is not null then
      for stopped in
        update private.email_subscriptions s
        set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
        from private.email_contacts c
        where c.id = s.contact_id and c.email_hash = target and s.status = 'active'
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

      update jobs.notification_jobs j
      set status = 'skipped', last_error = 'suppressed', updated_at = now()
      from private.email_contacts c
      where c.id = j.contact_id and c.email_hash = target
        and j.channel = 'email' and j.status = 'scheduled';

      update private.email_contacts c
      set status = 'suppressed',
          suppressed_at = coalesce(p_occurred_at, now()),
          suppression_reason = reason,
          verified_at = null,
          updated_at = now()
      where c.email_hash = target and c.status <> 'suppressed';

      -- The trigger above wrote this if any contact changed. If none did — the
      -- address has no contact left, or every one was already suppressed for
      -- another reason — the address is still one that bounced.
      insert into private.email_suppressions (email_hash, reason, suppressed_at)
      values (target, reason, coalesce(p_occurred_at, now()))
      on conflict (email_hash) do nothing;

      suppressed := true;
    end if;
  end if;

  perform jobs.emit('communication.delivery_recorded', 'delivery', event_id,
    jsonb_build_object(
      'delivery_id', event_id,
      'job_id', job.id,
      'contact_id', job.contact_id,
      'event_type', p_event_type,
      'suppressed', suppressed
    ));

  return jsonb_build_object(
    'recorded', true,
    'suppressed', suppressed,
    'contact_id', job.contact_id,
    'plan_id', job.plan_id,
    'circle_id', (select p.circle_id from public.plans p where p.id = job.plan_id)
  );
end;
$$;

comment on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) is
  'Stores one provider delivery event once, and on a hard bounce or a complaint suppresses the address, withdraws its subscriptions and skips its queued email, in one transaction. Returns ids only. Service role only; the webhook that calls it has verified the provider signature.';

revoke all on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) from public;
revoke all on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) from anon, authenticated;
grant execute on function public.record_email_delivery(text, text, timestamptz, boolean, bytea) to service_role;
