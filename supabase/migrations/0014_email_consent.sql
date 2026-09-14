-- ---------------------------------------------------------------------------
-- 0014 — asking for plan-update email, and stopping it (S1-18).
--
-- No new tables: `email_contacts`, `email_subscriptions`, `email_action_tokens`
-- and `email_suppressions` have been in `private` since 0006. What was missing
-- was the four functions that write them, and the one that reads them:
--
--   `public.request_email_updates`   consent, token and job, in one transaction
--   `public.verify_email_contact`    the link, consumed in one statement
--   `public.email_preferences`       stopping it, with no sign-in
--   `public.issue_reentry_token`     the way back for a guest with no session
--   `private.email_recipients_for`   who may be emailed about a plan
--   `jobs.idempotency_key`           architecture §13's key, in SQL
--
-- All five are `service_role` only. The endpoints above them are the door: two
-- of them take no session at all, because a link in an email is opened by
-- somebody who may have no account — and what authorises those is the token,
-- which is ≥256 bits, stored only as a digest, and single-use or expiring by
-- purpose (§14).
--
-- The last one is the join the dispatcher (S1-20) needs and should not write
-- for itself: a verified contact, an active subscription and an active
-- membership. Dropping any one of the three sends mail somebody did not ask
-- for, and "a **verified** email subscription" is what the domain's
-- `hasPlanEmailSubscription` has always meant.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/jobs/idempotency_key.sql
-- ---------------------------------------------------------------------------
-- `hash(channel, recipient, plan, revision, kind, occurrence)` — architecture
-- §13's key, in SQL.
--
-- The formula belongs to `packages/domain/communication/idempotency.ts` and is
-- written twice only because both writers need it: the dispatcher computes keys
-- in TypeScript, and the functions that enqueue an email from inside a
-- transaction know ids — a token's, a confirmation's — that no caller could
-- have passed in. A key composed two different ways is two jobs where the
-- unique index was meant to allow one, which is a second email to somebody who
-- has already had it.
--
-- So this mirrors the canonical form exactly, length prefixes and all: a plain
-- separator would let `('ab','c')` and `('a','bc')` collide, and a collision
-- here is a notification that silently never arrives. `130_jobs_keys.sql` pins
-- it to a value the domain's own function produces, so the two cannot drift
-- without a test saying so.
-- ---------------------------------------------------------------------------

create or replace function jobs.idempotency_key(
  p_channel text,
  p_recipient text,
  p_plan text,
  p_revision text,
  p_kind text,
  p_occurrence text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat(
        length(p_channel), ':', p_channel,
        length(p_recipient), ':', p_recipient,
        length(coalesce(p_plan, '')), ':', coalesce(p_plan, ''),
        length(coalesce(p_revision, '')), ':', coalesce(p_revision, ''),
        length(p_kind), ':', p_kind,
        length(p_occurrence), ':', p_occurrence
      ),
      'sha256'
    ),
    'hex'
  );
$$;

comment on function jobs.idempotency_key(text, text, text, text, text, text) is
  'The notification idempotency key of architecture §13, mirroring idempotencyKey() in packages/domain. Pinned to the domain''s output by 130_jobs_keys.sql.';

revoke all on function jobs.idempotency_key(text, text, text, text, text, text) from public;
revoke all on function jobs.idempotency_key(text, text, text, text, text, text) from anon, authenticated;
grant execute on function jobs.idempotency_key(text, text, text, text, text, text) to service_role;

-- supabase/sql/functions/jobs/run_retention.sql
-- ---------------------------------------------------------------------------
-- Retention (§8.5, ADR 0005).
--
-- One function, one rule per statement, each returning what it deleted so the
-- run can be read afterwards. Runs as the owner: the service role holds no
-- delete on the two logs and cannot touch `auth.users`, and that is right —
-- an Edge Function with the power to purge is a bigger surface than a cron
-- job in the database.
--
-- Things this deliberately does not delete:
--   * suppressed contacts — the suppression list is the promise not to send
--     again, and it has to outlive the address it is about;
--   * analytics events — the record;
--   * plans, responses, confirmations — the product's history.
-- ---------------------------------------------------------------------------

create or replace function jobs.run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_outbox integer;
  n_jobs integer;
  n_delivery integer;
  n_invites integer;
  n_tokens integer;
  n_pending_contacts integer;
  n_plan_contacts integer;
  n_summaries integer;
  n_summaries_purged integer;
  n_windows_aged integer;
  n_windows_gone integer;
  n_anonymous integer;
  n_requests integer;
  n_counters integer;
  n_audit integer;
  result jsonb;
begin
  -- Outbox and pipeline bookkeeping: 30 days. An unprocessed outbox row is
  -- never deleted, however old — the health job reports it instead.
  delete from jobs.outbox where processed_at < now() - interval '30 days';
  get diagnostics n_outbox = row_count;

  delete from jobs.notification_jobs where created_at < now() - interval '30 days';
  get diagnostics n_jobs = row_count;

  delete from private.email_delivery_events where recorded_at < now() - interval '30 days';
  get diagnostics n_delivery = row_count;

  -- Revoked invite hashes: 30 days.
  delete from public.circle_invites where revoked_at < now() - interval '30 days';
  get diagnostics n_invites = row_count;

  -- Expired or used tokens: 7 days after they stopped being usable.
  delete from private.email_action_tokens
  where expires_at < now() - interval '7 days'
     or used_at < now() - interval '7 days';
  get diagnostics n_tokens = row_count;

  -- Unverified contacts: 7 days. Somebody typed an address and never clicked
  -- the link; the address does not stay — unless a link they could still
  -- click exists, because a contact that asked for a fresh link yesterday is
  -- not one that gave up a week ago, and the cascade would take the link.
  --
  -- Or unless the link has not been *made* yet. Since ADR 0020 the token is
  -- minted when the email is sent, so a contact that asked a minute ago holds
  -- a queued `verify_email` and no token at all. That is fine for a new
  -- contact — `created_at` is a minute old — and wrong for a resend, because
  -- the upsert keeps the original `created_at`: somebody who asked eight days
  -- ago, let the link lapse and asked again would have had this run delete the
  -- contact, the queued email and the consent in the gap before the dispatcher
  -- drained it, having just been told to check their email.
  --
  -- It cannot keep a contact for ever: the `notification_jobs` rule above runs
  -- first in this same function and takes any job older than thirty days, so a
  -- job that never drains stops sparing its contact a month later.
  delete from private.email_contacts c
  where c.status = 'pending'
    and c.created_at < now() - interval '7 days'
    and not exists (
      select 1 from private.email_action_tokens t
      where t.contact_id = c.id and t.used_at is null and t.expires_at > now()
    )
    and not exists (
      select 1 from jobs.notification_jobs j
      where j.contact_id = c.id and j.kind = 'verify_email' and j.status = 'scheduled'
    );
  get diagnostics n_pending_contacts = row_count;

  -- Verified plan-only contacts: 30 days after every plan they were subscribed
  -- to has finished. Every contact in the MVP is plan-only (spec §3: no
  -- marketing consent), so "plan-only" means "verified and not suppressed".
  -- A contact with a live subscription stays; one whose plans have all been
  -- completed, cancelled or expired for 30 days goes, address and all. A
  -- withdrawn subscription keeps nothing: the person said stop, and the
  -- address has no reason left to be here.
  delete from private.email_contacts c
  where c.status = 'verified'
    and not exists (
      select 1
      from private.email_subscriptions s
      join public.plans p on p.id = s.plan_id
      where s.contact_id = c.id
        and s.status = 'active'
        and (p.state not in ('completed', 'cancelled', 'expired')
             or p.updated_at > now() - interval '30 days')
    )
    and c.verified_at < now() - interval '30 days';
  get diagnostics n_plan_contacts = row_count;

  -- Willing windows, rule one (ADR 0005): 12 months, for members of active
  -- circles — after the summary is written, from everything still stored,
  -- so that what the member usually offers survives the windows going.
  -- Dropped first: two runs in one transaction (a test, a retry) would
  -- otherwise meet their own table.
  perform set_config('client_min_messages', 'warning', true);
  drop table if exists aged_responses;
  create temporary table aged_responses on commit drop as
    select r.id as response_id, p.circle_id, r.user_id
    from public.plan_responses r
    join public.plans p on p.id = r.plan_id
    join public.circles c on c.id = p.circle_id
    join public.circle_members m on m.circle_id = c.id and m.user_id = r.user_id
    where r.submitted_at < now() - interval '12 months'
      and c.status = 'active'
      and m.status = 'active'
      and exists (select 1 from public.willing_windows w where w.response_id = r.id);

  -- Added to what is already summarised, never recomputed from what is left:
  -- the windows that went last time are in the stored counts and nowhere else.
  insert into public.member_dayparts (circle_id, user_id, summary, computed_at)
  select g.circle_id, g.user_id,
    jobs.daypart_summary(jobs.add_daypart_counts(
      coalesce((select d.summary -> 'counts' from public.member_dayparts d
                where d.circle_id = g.circle_id and d.user_id = g.user_id), '{}'::jsonb),
      jobs.daypart_counts(g.response_ids)
    )),
    now()
  from (
    select a.circle_id, a.user_id, array_agg(a.response_id) as response_ids
    from aged_responses a group by a.circle_id, a.user_id
  ) g
  on conflict (circle_id, user_id) do update
    set summary = excluded.summary, computed_at = excluded.computed_at;
  get diagnostics n_summaries = row_count;

  delete from public.willing_windows w
  using aged_responses a
  where w.response_id = a.response_id;
  get diagnostics n_windows_aged = row_count;

  -- Willing windows, rule two: 30 days after removal or archiving. No summary
  -- — a removed member's pre-fill is nobody's to keep — and the summary that
  -- was written while they were a member goes with the windows.
  delete from public.member_dayparts d
  using public.circle_members m, public.circles c
  where m.circle_id = d.circle_id and m.user_id = d.user_id
    and c.id = d.circle_id
    and (
      (m.status = 'removed' and m.updated_at < now() - interval '30 days')
      or (c.status = 'archived' and c.updated_at < now() - interval '30 days')
    );
  get diagnostics n_summaries_purged = row_count;

  delete from public.willing_windows w
  using public.plan_responses r, public.plans p, public.circles c, public.circle_members m
  where w.response_id = r.id
    and p.id = r.plan_id
    and c.id = p.circle_id
    and m.circle_id = c.id and m.user_id = r.user_id
    and (
      (m.status = 'removed' and m.updated_at < now() - interval '30 days')
      or (c.status = 'archived' and c.updated_at < now() - interval '30 days')
    );
  get diagnostics n_windows_gone = row_count;

  -- Abandoned anonymous identities: a guest session that never joined
  -- anything, 30 days on. The cascade takes the profile.
  delete from auth.users u
  where coalesce(u.is_anonymous, false)
    and u.created_at < now() - interval '30 days'
    and not exists (select 1 from public.circle_members m where m.user_id = u.id);
  get diagnostics n_anonymous = row_count;

  -- The Edge Function kit's own bookkeeping (S1-13). Both of these are written
  -- on every request and read only by the request after it, so without a rule
  -- they are the two tables in the schema that grow forever.
  --
  -- Seven days for a served request, which is a retry window with a great deal
  -- of room in it: a client that has not retried inside a week is a client that
  -- has moved on, and the mutations themselves are idempotent by their own state
  -- anyway. An *unfinished* one is kept, however old — it means a function died
  -- between claiming a key and answering, and that is worth being able to find.
  delete from jobs.idempotent_requests
  where status = 'done' and completed_at < now() - interval '7 days';
  get diagnostics n_requests = row_count;

  -- A counter outside its own window can never be read again: `take_rate_token`
  -- computes `window_start` from the clock and only ever touches the current
  -- one. A day's grace, so that nothing is deleted while it is still counting.
  delete from jobs.rate_counters where window_start < now() - interval '1 day';
  get diagnostics n_counters = row_count;

  -- Audit log: 12 months.
  delete from private.audit_log where occurred_at < now() - interval '12 months';
  get diagnostics n_audit = row_count;

  result := jsonb_build_object(
    'outbox', n_outbox,
    'notification_jobs', n_jobs,
    'delivery_events', n_delivery,
    'revoked_invites', n_invites,
    -- Not "tokens": the key would trip the no-content check that guards the
    -- audit log, and rightly — a count of links is what this is.
    'expired_action_links', n_tokens,
    'pending_contacts', n_pending_contacts,
    'plan_only_contacts', n_plan_contacts,
    'daypart_summaries', n_summaries,
    'daypart_summaries_purged', n_summaries_purged,
    'windows_aged', n_windows_aged,
    'windows_of_the_gone', n_windows_gone,
    'anonymous_identities', n_anonymous,
    'served_requests', n_requests,
    'rate_counters', n_counters,
    'audit_rows', n_audit
  );

  -- The run is itself a fact worth keeping for a year: counts only.
  insert into private.audit_log (action, resource_type, metadata)
  values ('retention.ran', 'account', result);

  return result;
end;
$$;

comment on function jobs.run_retention() is
  'The daily retention rules of §8.5 and ADR 0005, one statement each; returns what each deleted. Runs as the owner from pg_cron.';

revoke all on function jobs.run_retention() from public;
revoke all on function jobs.run_retention() from anon, authenticated;
revoke all on function jobs.run_retention() from service_role;

-- supabase/sql/functions/private/email_recipients_for.sql
-- ---------------------------------------------------------------------------
-- Who may be emailed about a plan.
--
-- Written once, here, because it is the join that "a **verified** email
-- subscription to this plan" (the domain's `hasPlanEmailSubscription`) actually
-- means, and because the dispatcher (S1-20) is not the place to work it out
-- again. Three conditions, and dropping any one of them sends mail somebody did
-- not ask for:
--
--   * the contact is **verified** — an address typed wrong has a pending
--     contact, and consent recorded against it is consent from whoever owns the
--     address, not from whoever typed it;
--   * the subscription is **active** — asked for, and not stopped since;
--   * the person is still an **active member** of the circle, because "only
--     active members see or act on it" (AGENTS.md) does not stop being true
--     because the channel is email.
--
-- It returns ids, never addresses: the address is read once, by the sender,
-- from the row this points at.
-- ---------------------------------------------------------------------------

create or replace function private.email_recipients_for(p_plan_id uuid)
returns table (contact_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.user_id
  from private.email_subscriptions s
  join private.email_contacts c on c.id = s.contact_id
  join public.plans p on p.id = s.plan_id
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = c.user_id
  where s.plan_id = p_plan_id
    and s.scope = 'plan_updates'
    and s.status = 'active'
    and c.status = 'verified'
    and m.status = 'active'
  order by c.id;
$$;

comment on function private.email_recipients_for(uuid) is
  'The contacts that may receive plan-update email for one plan: verified contact, active subscription, active member. Ids only, never addresses.';

revoke all on function private.email_recipients_for(uuid) from public;
revoke all on function private.email_recipients_for(uuid) from anon, authenticated;
grant execute on function private.email_recipients_for(uuid) to service_role;

-- supabase/sql/functions/public/email_preferences.sql
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
    --
    -- Narrow in *plans*, not in rows: every contact holding this address stops
    -- hearing about this meetup. One address can be held by two identities
    -- (0009) and the dispatcher sends "one copy per event, by `distinct
    -- email_hash`" — so one letter reaches the mailbox carrying one contact's
    -- link, and stopping only that contact left the next copy to be sent
    -- through the sibling. A one-tap unsubscribe that does not stop the email
    -- is not one, and this is the Spam Act's tap (spec §13).
    --
    -- It tells the tapper nothing they did not already have: the letter they
    -- are holding named this plan and this circle.
    for stopped in
      update private.email_subscriptions s
      set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
      from private.email_contacts c
      where c.id = s.contact_id
        and c.email_hash = owner.email_hash
        and s.plan_id = p_plan_id
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
            -- Active means "will actually be emailed", which is the question
            -- the page is answering — so it is asked of the one query that
            -- decides, rather than of a predicate that looks like it. Spelling
            -- out "verified and active" here missed the third condition,
            -- membership, and told somebody who had been removed from the
            -- circle that their email was on.
            'active', exists (
              select 1 from private.email_recipients_for(s.plan_id) r
              where r.contact_id = s.contact_id
            )
          )
          order by p.window_start desc, s.plan_id
        ),
        '[]'::jsonb
      )
      from private.email_subscriptions s
      join private.email_contacts c on c.id = s.contact_id
      join public.plans p on p.id = s.plan_id
      join public.circles ci on ci.id = p.circle_id
      -- And a plan whose circle they have left is not listed at all. Nothing
      -- will be sent about it, so there is nothing to stop — and the row
      -- carried the plan's title *as it is now*, which is a live feed of a
      -- circle they are no longer in (AGENTS.md: "only active members see or
      -- act on it").
      join public.circle_members m
        on m.circle_id = p.circle_id and m.user_id = c.user_id and m.status = 'active'
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

-- supabase/sql/functions/public/issue_reentry_token.sql
-- ---------------------------------------------------------------------------
-- The single-use way back into a circle, for a guest with no session.
--
-- Every event email carries one (spec §5.8, §5.11): "a guest returns with no
-- session" is the most common real thing that happens (§9), and without this
-- their only way back is a link somebody else has to resend. Seven days,
-- single-use, and consumed by `reattach-member` (S1-13), which moves the
-- membership onto whatever identity the browser has now.
--
-- **Null for a saved-place identity**, because that is not a fault. Every event
-- email carries a re-entry link and permanent members get event email too; the
-- template simply leaves the link out for somebody who can sign in. Reaching
-- the table's own guard instead — `enforce_reentry_for_guests`, which raises
-- `check_violation` — turned an ordinary rendering decision into a SQLSTATE
-- nothing can translate and a 500 for the reader. The trigger stays: it is the
-- rule, and this is the answer the one caller needs. A sign-in bypass is still
-- impossible, now twice over.
--
-- Service role only. It mints nothing itself — the Edge Function generates the
-- token and passes the digest, so the readable form is never a statement
-- parameter and never reaches a query log (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_reentry_token(
  p_circle_id uuid,
  p_user_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_id uuid;
  token_id uuid;
begin
  -- Somebody who signs in needs no way back, so there is nothing to issue and
  -- nothing has gone wrong. Checked before the membership, because a permanent
  -- identity's membership is beside the point.
  if exists (select 1 from public.profiles pr where pr.user_id = p_user_id and pr.is_permanent) then
    return null;
  end if;

  -- The membership has to be one. A token for a circle this person is not in
  -- would be a link back into somebody else's circle, and the foreign key that
  -- would have caught it raises a SQLSTATE nothing can translate — a 500 for an
  -- ordinary mistake.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  -- The contact this belongs to: a re-entry link travels in an email, so there
  -- is one. Its owner and the membership's owner are the same person, which the
  -- table's own foreign key insists on as well.
  select c.id into contact_id
  from private.email_contacts c
  where c.user_id = p_user_id and c.status = 'verified'
  order by c.verified_at desc
  limit 1;

  if contact_id is null then
    raise exception 'no_verified_contact' using errcode = 'P0001';
  end if;

  insert into private.email_action_tokens (
    contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id
  )
  values (contact_id, 'reentry', p_token_hash, now() + interval '7 days', p_circle_id, p_user_id)
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_reentry_token(uuid, uuid, bytea) is
  'Stores the digest of a seven-day single-use re-entry token for a guest membership, and returns null for a saved-place identity, which needs no link. The token itself is minted in the Edge Function and never reaches the database. Service role only.';

revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from public;
revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.issue_reentry_token(uuid, uuid, bytea) to service_role;

-- supabase/sql/functions/public/issue_verification_token.sql
-- ---------------------------------------------------------------------------
-- The link that goes in the verification email, minted when the email is sent.
--
-- The readable token exists in two places and no others: the sender's memory
-- for the length of one send, and the letter itself (§14). That is only
-- possible if it is made at send time — a token minted when the person asked
-- would have to travel to the sender somehow, and every route is one this
-- repository has closed: `jobs.notification_jobs` carries ids and no payload,
-- `jobs.outbox` refuses a key called `token`, and the token table holds a
-- digest. ADR 0020 records the decision; `request_email_updates` writes the
-- job that brings the dispatcher here.
--
-- **Null is an ordinary answer.** By the time a queued `verify_email` is
-- drained, the contact may have been verified by another link, suppressed by a
-- bounce, or removed by its owner. None of those is a failure the sender should
-- retry — the job is simply skipped — and an exception for each would make a
-- routine outcome look like a fault.
--
-- "Resend invalidates the previous token" (spec §5.8) lives here now, because
-- here is where a token starts existing. Spent rather than deleted, so somebody
-- clicking the older link is told it is used rather than that it never was.
-- ---------------------------------------------------------------------------

create or replace function public.issue_verification_token(
  p_contact_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact private.email_contacts;
  token_id uuid;
begin
  -- Locked, because two dispatcher workers draining two jobs for one contact
  -- would otherwise each spend the other's token and send two letters of which
  -- only the later works.
  --
  -- This takes the contact before the tokens, while `verify_email_contact`
  -- takes the token before the contacts — so a click that lands while a resend
  -- is being sent can deadlock, and Postgres will kill one of them. Accepted
  -- rather than ordered, as 0009 accepted the same shape between two webhooks
  -- ("left as a retry"): the loser's token is not consumed, the reader is told
  -- to try again, and the second tap works. Ordering them would mean reading
  -- the token without consuming it and locking by hash first, which puts a
  -- window between the read and the spend — a worse trade for a rarer fault.
  select * into contact from private.email_contacts c where c.id = p_contact_id for update;

  if not found or contact.status <> 'pending' then
    return null;
  end if;

  update private.email_action_tokens t
  set used_at = now()
  where t.contact_id = p_contact_id and t.purpose = 'verify' and t.used_at is null;

  insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
  values (p_contact_id, 'verify', p_token_hash, now() + interval '24 hours')
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_verification_token(uuid, bytea) is
  'Stores the digest of a 24-hour single-use verification token and spends the contact''s previous ones. Null when there is nothing left to verify, which the sender treats as a skipped job. The token itself is minted in the Edge Function. Service role only.';

revoke all on function public.issue_verification_token(uuid, bytea) from public;
revoke all on function public.issue_verification_token(uuid, bytea) from anon, authenticated;
grant execute on function public.issue_verification_token(uuid, bytea) to service_role;

-- supabase/sql/functions/public/request_email_updates.sql
-- ---------------------------------------------------------------------------
-- "Email me about this meetup."
--
-- Three writes that have to happen together or not at all: the contact, the
-- consent, and the job that sends the verification email. A contact with no job
-- is an address stored for nothing; a job with no subscription would send an
-- email nobody asked for.
--
-- **The token is not one of them.** It is minted when the email is sent, by
-- whoever sends it (ADR 0020) — a token minted here has no way of reaching the
-- letter: `jobs.notification_jobs` carries ids and no payload, the outbox
-- refuses any key named `token`, and the row in `email_action_tokens` holds
-- only a digest. An earlier draft took `p_token_hash`, wrote the row, and threw
-- the readable half away in the Edge Function, which made every verification
-- link unsendable and every token row expire unused.
--
-- **One address can belong to two identities.** Uniqueness has been
-- `(email_hash, user_id)` since 0009 — "two guest memberships may each be
-- reachable at the same address (spec §9)" — so this inserts *this person's*
-- contact for the address and says nothing about anybody else's. An earlier
-- draft read the address back by hash alone and refused when the row belonged
-- to somebody else, which turned the commonest real case into a permanent
-- silence: a guest who loses their session, rejoins as a new identity and asks
-- again was told "check your email" and never heard anything.
--
-- **Suppression is not looked up here.** `apply_suppression` gives a new
-- contact for a tombstoned address the status `suppressed` on insert, and
-- `record_suppression` carries a suppression across every contact holding that
-- address. So the honest thing is to insert and read the status back, which is
-- what the note from S1-11 says: "never write `status = 'pending'` over it".
--
-- **It answers the same way whatever happened.** Suppressed, already verified,
-- or new: `sent` says whether an email was enqueued and nothing else, and the
-- endpoint above turns all of them into "check your email". Four different
-- answers would let a member walk a list of addresses through a plan and learn
-- which of their friends use the product.
-- ---------------------------------------------------------------------------

create or replace function public.request_email_updates(
  p_plan_id uuid,
  p_user_id uuid,
  -- Already trimmed, lower-cased and NFC-normalised by the request schema; the
  -- column's own check refuses anything else, so the two agree.
  p_email text,
  p_consent_version text,
  -- The request this is, which is what architecture §13 calls the occurrence
  -- for `verify_email`: a retry never reaches this function (the idempotency
  -- claim answers it), and a genuine resend is a new request and so a new
  -- email. Not a token id any more, because there is no token here to name.
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  contact private.email_contacts;
  subscription private.email_subscriptions;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- A member of the plan's circle, asked of the person the Edge Function
  -- identified rather than of `auth.uid()`: this runs as the service role, so
  -- there is no caller for the database to ask about. The same answer for "no
  -- such plan" and "not your circle", which is what every other read of a plan
  -- does.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Nothing to subscribe to. "Verification after the plan completed or was
  -- cancelled: no stale mail is sent" (spec §9) is the same sentence one step
  -- earlier: asking for email about a meetup that is over would enqueue a
  -- verification message about something that has already happened.
  if plan.state in ('completed', 'cancelled', 'expired') then
    raise exception 'plan_is_finished' using errcode = 'P0001';
  end if;

  -- This person's contact for this address. The insert is where suppression is
  -- decided: `apply_suppression` stamps a tombstoned address as `suppressed`
  -- before the row lands, and an existing row keeps whatever status it has.
  insert into private.email_contacts (user_id, email_normalized)
  values (p_user_id, p_email)
  on conflict (email_hash, user_id) do update set updated_at = now()
  returning * into contact;

  if contact.status = 'suppressed' then
    -- Nothing more is written and nothing is sent. The person asking may not be
    -- the person who suppressed it, and spec §9's "no automatic reactivation"
    -- is the address owner's decision rather than theirs.
    return jsonb_build_object('sent', false);
  end if;

  -- The consent, recorded now with the words it was given for, because now is
  -- when it was given. The subscription is `active` from this moment and the
  -- *contact* is what is unverified: `private.email_recipients_for` sends to a
  -- verified contact with an active subscription and an active membership, and
  -- to nobody else, so an address somebody typed wrong receives nothing while
  -- the row honestly says what was agreed and when (ADR 0019).
  --
  -- Asking again after stopping starts it again — a fresh consent from the
  -- person who owns the address, which is a different thing from the automatic
  -- reactivation of a *suppressed* address that spec §9 forbids.
  insert into private.email_subscriptions (
    contact_id, user_id, scope, plan_id, status, consent_text_version
  )
  values (contact.id, p_user_id, 'plan_updates', p_plan_id, 'active', p_consent_version)
  on conflict (contact_id, scope, plan_id) do update
    set status = 'active',
        withdrawn_at = null,
        consent_text_version = excluded.consent_text_version,
        updated_at = now()
  returning * into subscription;

  perform jobs.emit('communication.subscription_changed', 'subscription', subscription.id,
    jsonb_build_object(
      'subscription_id', subscription.id,
      'contact_id', contact.id,
      'plan_id', p_plan_id,
      'status', subscription.status
    ));

  -- A verified address needs no second verification: the subscription above is
  -- already live, and another link would be an email nobody asked for.
  if contact.status = 'verified' then
    return jsonb_build_object('sent', false);
  end if;

  insert into jobs.notification_jobs (
    channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
  )
  values (
    'email', 'verify_email', contact.id, p_plan_id, plan.revision, now(),
    -- Architecture §13's key, composed the one way (`jobs.idempotency_key`).
    -- The dispatcher will mint the token for this job when it sends it and
    -- spend whatever came before (`public.issue_verification_token`), which is
    -- where "resend invalidates the previous token" (spec §5.8) now lives:
    -- one job, one letter, one live link.
    jobs.idempotency_key(
      'email', contact.id::text, p_plan_id::text, plan.revision::text,
      'verify_email', p_request_id)
  )
  -- Belt and braces behind the idempotency claim in the Edge Function, which is
  -- what actually answers a retry: the same request id twice is the same key,
  -- and the second insert is the no-op it should be.
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('sent', true);
end;
$$;

comment on function public.request_email_updates(uuid, uuid, text, text, text) is
  'Records consent to plan-update email for one plan and enqueues the verification email; the token is minted by the sender (ADR 0020). One address may belong to two identities; suppression is decided by the insert trigger. Answers the same way whatever happened. Service role only.';

revoke all on function public.request_email_updates(uuid, uuid, text, text, text) from public;
revoke all on function public.request_email_updates(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function public.request_email_updates(uuid, uuid, text, text, text) to service_role;

-- supabase/sql/functions/public/verify_email_contact.sql
-- ---------------------------------------------------------------------------
-- The link in the verification email.
--
-- One statement does the consuming, and it has to: `update … where token_hash =
-- $1 and used_at is null and expires_at > now() returning …` is what makes
-- "single use" true when two clicks arrive together. Reading the row and then
-- marking it used is the version with the race in it.
--
-- **Verification is by address, not by row.** Uniqueness has been
-- `(email_hash, user_id)` since 0009, and `private.reconcile_contacts` splits a
-- contact when its identity's memberships are divided — so one person can hold
-- one address on two contacts, one verified and one pending. Verifying only the
-- contact the token names leaves the sibling pending, and retention deletes a
-- pending contact after seven days *with its subscription*: the consent
-- disappears without anybody withdrawing it. Suppression already works this way
-- by hash (`record_suppression`); this is the same reasoning in the other
-- direction.
--
-- What verification changes is the **contact**, not the consent. That was
-- recorded when it was given (ADR 0019), and an unverified contact is what
-- stops mail reaching an address somebody typed wrong.
-- ---------------------------------------------------------------------------

create or replace function public.verify_email_contact(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token private.email_action_tokens;
  contact private.email_contacts;
  own_plans uuid[];
  stopped private.email_subscriptions;
  decided record;
  already_confirmed boolean;
begin
  update private.email_action_tokens t
  set used_at = now()
  where t.token_hash = p_token_hash
    and t.purpose = 'verify'
    and t.used_at is null
    and t.expires_at > now()
  returning * into token;

  -- Spent, expired or never ours: one answer for all three. Telling them apart
  -- would say whether a token existed, and what the screen offers is the same
  -- either way — ask for a new link.
  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  select * into contact from private.email_contacts c where c.id = token.contact_id;

  -- A suppressed address stays suppressed. Clicking a link that predates the
  -- bounce is not the address asking to hear from us again (spec §9).
  if contact.status = 'suppressed' then
    return jsonb_build_object('active_plan_ids', '[]'::jsonb, 'already_confirmed', false);
  end if;

  -- Every contact holding this address, not only the one the link named.
  update private.email_contacts c
  set status = 'verified', verified_at = now(), updated_at = now()
  where c.email_hash = contact.email_hash and c.status = 'pending';

  -- The plans that are over take their subscriptions with them, across all of
  -- them: "verification after the plan completed or was cancelled: no stale
  -- mail is sent" (spec §9).
  --
  -- Row by row, because each one is a consent ending and a consent that ends
  -- without an event is a consent that stops for reasons nothing downstream can
  -- see. `email_preferences` says the same thing the same way; a withdrawal
  -- that emits in one function and not in the other is one rule written twice,
  -- differently.
  for stopped in
    update private.email_subscriptions s
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    from public.plans p, private.email_contacts c
    where c.email_hash = contact.email_hash
      and s.contact_id = c.id
      and s.status = 'active'
      and p.id = s.plan_id
      and p.state in ('completed', 'cancelled', 'expired')
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

  -- What *this* identity will now hear about: an active subscription of their
  -- own, on a plan whose circle they are still in. A removal ends the plan for
  -- them (AGENTS.md: "only active members see or act on it"), and the channel
  -- being email does not change that.
  --
  -- Their own, and not the address's: verification crosses the siblings because
  -- the address is what is being proved, but the *answer* goes to one browser
  -- held by one identity, and the plans another identity is subscribed to are
  -- not theirs to be told about. Spec §9: memberships are not revealed to each
  -- other, and two guests at one mailbox are still two people.
  select coalesce(array_agg(distinct s.plan_id), array[]::uuid[])
  into own_plans
  from private.email_subscriptions s
  join public.plans p on p.id = s.plan_id
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = contact.user_id
  where s.contact_id = contact.id
    and s.status = 'active'
    and m.status = 'active';

  -- The current state, once, for somebody who verified after it was decided —
  -- and once *per subscription*, against the contact that holds it.
  --
  -- The recipient is the subscription's contact, never the one the link named.
  -- Writing `contact.id` for a sibling's plan produced a job for somebody who
  -- is not in that circle: `email_recipients_for` names a different contact, so
  -- a drain racing this verification sends the same letter twice; the re-entry
  -- link the template needs raises `not_a_member`; and the "stop this meetup"
  -- link in it is scoped to a subscription that does not exist. One row per
  -- (contact, confirmed plan), for the same reason `live_plans` was a set: an
  -- address subscribed to two decided plans is owed both.
  already_confirmed := false;

  for decided in
    select s.contact_id, s.plan_id, mc.id as confirmation_id, mc.revision
    from private.email_subscriptions s
    join private.email_contacts c on c.id = s.contact_id
    join public.plans p on p.id = s.plan_id
    join public.circle_members m on m.circle_id = p.circle_id and m.user_id = c.user_id
    join public.meetup_confirmations mc on mc.plan_id = p.id and mc.status = 'active'
    where c.email_hash = contact.email_hash
      and s.status = 'active'
      and m.status = 'active'
  loop
    insert into jobs.notification_jobs (
      channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
    )
    values (
      'email', 'locked_in', decided.contact_id, decided.plan_id, decided.revision, now(),
      -- Architecture §13's key, composed the one way (`jobs.idempotency_key`),
      -- so that the dispatcher's own `locked_in` for this recipient and this
      -- confirmation *is* this job: verifying late cannot produce a second copy
      -- of an email they have already had.
      jobs.idempotency_key(
        'email', decided.contact_id::text, decided.plan_id::text, decided.revision::text,
        'locked_in', decided.confirmation_id::text)
    )
    on conflict (idempotency_key) do nothing;

    if decided.plan_id = any (own_plans) then
      already_confirmed := true;
    end if;
  end loop;

  -- About the contact, not about a plan: this happens once per address, and
  -- which plans it turned out to be subscribed to is a consequence rather than
  -- the fact. The payload is ids, because an address is the one thing that may
  -- never be in one (non-negotiable 8).
  perform jobs.emit('communication.contact_verified', 'contact', contact.id,
    jsonb_build_object('contact_id', contact.id, 'user_id', contact.user_id));

  return jsonb_build_object(
    'active_plan_ids', to_jsonb(own_plans),
    'already_confirmed', already_confirmed
  );
end;
$$;

comment on function public.verify_email_contact(bytea) is
  'Consumes a verification token in one statement and verifies every contact holding that address, drops subscriptions to finished plans, and queues the current state for each decided plan against the contact that subscribed to it. Answers with the clicking identity''s own plans only. Service role only.';

revoke all on function public.verify_email_contact(bytea) from public;
revoke all on function public.verify_email_contact(bytea) from anon, authenticated;
grant execute on function public.verify_email_contact(bytea) to service_role;

-- END GENERATED: function definitions
