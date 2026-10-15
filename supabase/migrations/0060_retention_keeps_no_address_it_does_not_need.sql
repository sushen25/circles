-- 0060_retention_keeps_no_address_it_does_not_need
--
-- Three places kept something about a person for longer than anything needed
-- it, and none of them was bounded by a rule:
--
--   * a suppressed contact kept its address in clear for ever. Retention took
--     only verified contacts, and the tombstone that keeps the promise not to
--     send again is a hash anyway;
--   * GoTrue's own audit log holds the address of every sign-in and was never
--     pruned;
--   * `analytics.events.user_id` had no foreign key, so an event outlived its
--     user with the identity still on it, where the routine that deletes an
--     account (SUS-66) could not find it.
--
-- ADR 0074 is the record. The function bodies in the generated block are
-- rendered from supabase/sql/functions (`pnpm gen:functions`).

-- ---------------------------------------------------------------------------
-- 1. A suppressed contact keeps the hash and not the address.
--
-- `email_hash` was generated from `email_normalized`, so the address could not
-- go without the hash going with it. It becomes a plain column that
-- `private.apply_suppression` keeps equal to the hash of the address for as
-- long as there is one. Existing values are kept as they are.
-- ---------------------------------------------------------------------------

alter table private.email_contacts alter column email_hash drop expression;
alter table private.email_contacts alter column email_normalized drop not null;

-- Every contact already suppressed loses its address now. The hash is untouched.
update private.email_contacts set email_normalized = null where status = 'suppressed';

-- The two states cannot disagree: no address means suppressed, and a suppressed
-- row has no address.
alter table private.email_contacts add constraint email_contacts_address_kept
  check ((status = 'suppressed') = (email_normalized is null));

comment on column private.email_contacts.email_normalized is
  'The address, in clear, for as long as the contact can be mailed. Null exactly when the status is suppressed: the tombstone and email_hash carry the promise not to send, and retention deletes the row after 30 days (ADR 0074).';
comment on column private.email_contacts.email_hash is
  'SHA-256 of the address, kept equal to it by private.apply_suppression while there is one, and kept when the address is nulled on suppression.';

-- The same function now runs on update as well as insert: a bounce, a
-- complaint or an unsubscribe is an update of `status`, and that is the moment
-- the address has to go.
drop trigger email_contacts_apply_suppression on private.email_contacts;
create trigger email_contacts_apply_suppression
  before insert or update of email_normalized, status on private.email_contacts
  for each row execute function private.apply_suppression();

-- ---------------------------------------------------------------------------
-- 2. An event follows its user.
--
-- `on delete set null`, because the spec already says account deletion nulls
-- the identifiers and keeps the history, and a foreign key makes it structural
-- rather than a step somebody must remember. Who started a plan no longer
-- lives here (SUS-177 keeps it in `private.audit_log`), so nulling the user on
-- an event loses attribution and nothing a gate reads.
--
-- Safe at this size: the rows whose user is already gone are nulled first (the
-- anonymous-identity retention rule has been deleting users for a while), the
-- constraint's own validation is one scan of the table under a lock that holds
-- writers off for its length, and `events_user_plan_time_idx` leads with
-- `user_id`, so deleting a user finds their events by index. Events are
-- ingested in small batches by one function and the table is small before
-- launch. If it were not, add the constraint `not valid` in one deploy and
-- `validate constraint` in the next.
-- ---------------------------------------------------------------------------

update analytics.events e set user_id = null
where e.user_id is not null
  and not exists (select 1 from auth.users u where u.id = e.user_id);

alter table analytics.events add constraint events_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

comment on column analytics.events.user_id is
  'The signed-in user the event is about, or null: it is set null when the user is deleted (ADR 0074).';

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

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
--   * the suppression list (`private.email_suppressions`) — it is the promise
--     not to send again, it holds only a hash, and it has to outlive the
--     contact it came from;
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
  n_audit_plans integer;
  n_auth_audit integer;
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

  -- Plan-only contacts, verified or suppressed: 30 days after every plan they were subscribed
  -- to has finished. "Plan-only" used to mean "verified and not suppressed",
  -- because every contact in the MVP was one somebody gave for a plan (spec
  -- §3: no marketing consent). Two of them are not, and each would otherwise
  -- be deleted along with the letters still hanging off it — the fkey is
  -- `on delete cascade`, so the row going takes the queued mail silently.
  --
  --   * **An identity's own confirmed auth address** (ADR 0027, S1-20). It is
  --     not a plan's: it is how the organiser is written to at all, for as
  --     long as the identity exists, and it holds no subscription by design.
  --     Deleted with the user by the cascade, which is the right lifetime.
  --     Thirty days after an organiser's first plan, this rule was taking it —
  --     and with it the "did it happen?" letter due at nine the next morning.
  --   * **Any contact with a job still waiting.** Independent of whose address
  --     it is: a scheduled row is a message somebody is owed, and deleting the
  --     contact under it is the one failure nobody would ever see. The
  --     `notification_jobs` rule above still takes jobs older than thirty
  --     days, so this cannot keep a contact for ever.
  --
  -- A suppressed contact is on the same clock. It holds no address any more
  -- (`apply_suppression` nulls it the moment the row is suppressed), only the
  -- hash that the tombstone in `private.email_suppressions` also holds, so the
  -- row is deleted for the same reason a verified one is: nothing is owed to it.
  -- The tombstone stays, and a contact made later for that address arrives
  -- suppressed. Its subscriptions were withdrawn and its letters skipped when it
  -- was suppressed, and the same "no plan still running, no job still waiting"
  -- tests apply, so the cascade takes nothing that matters.
  delete from private.email_contacts c
  where c.status in ('verified', 'suppressed')
    and not exists (
      select 1
      from private.email_subscriptions s
      join public.plans p on p.id = s.plan_id
      where s.contact_id = c.id
        and s.status = 'active'
        and (p.state not in ('completed', 'cancelled', 'expired')
             or p.updated_at > now() - interval '30 days')
    )
    and not (
      c.status = 'verified'
      and exists (
        select 1 from auth.users u
        where u.id = c.user_id
          and u.email_confirmed_at is not null
          and c.email_hash = extensions.digest(lower(btrim(u.email)), 'sha256')
      )
    )
    and not exists (
      select 1 from jobs.notification_jobs j
      where j.contact_id = c.id and j.status = 'scheduled'
    )
    and coalesce(c.verified_at, c.suppressed_at) < now() - interval '30 days';
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

  -- Audit log: 12 months, except who started a plan (below).
  -- `plan.created` (who started a plan, SUS-177) is not a 12-month fact: the
  -- founder's organiser gate reads it for as long as the plan exists. It goes
  -- when the plan does (a circle's deletion cascades to its plans), and not
  -- before.
  delete from private.audit_log
  where occurred_at < now() - interval '12 months' and action <> 'plan.created';
  get diagnostics n_audit = row_count;

  delete from private.audit_log a
  where a.action = 'plan.created'
    and not exists (select 1 from public.plans p where p.id = a.resource_id);
  get diagnostics n_audit_plans = row_count;
  n_audit := n_audit + n_audit_plans;

  -- GoTrue's own audit log: 90 days. It records every sign-in with the address
  -- that signed in, in clear, so it is bounded far shorter than ours. Its
  -- `created_at` is not indexed; the daily run deletes one day's worth, and the
  -- first run after this rule shipped deletes the backlog in one statement.
  delete from auth.audit_log_entries where created_at < now() - interval '90 days';
  get diagnostics n_auth_audit = row_count;

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
    'audit_rows', n_audit,
    'auth_audit_entries', n_auth_audit
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

-- supabase/sql/functions/private/apply_suppression.sql
-- A suppressed contact keeps the hash of its address and not the address.
--
-- `private.email_suppressions` already holds the tombstone that keeps the
-- promise not to send again, and it is a hash. Nothing mails a suppressed
-- contact, so the clear address on its row serves nobody and used to sit there
-- for ever (retention took only verified contacts). Once a row is suppressed,
-- by whichever path — a bounce, a complaint, an unsubscribe, or an insert for
-- an address that was already tombstoned — this trigger nulls it.
--
-- That needed the hash to stop being derived from the address. `email_hash`
-- was a generated column over `email_normalized`; it is a plain column now,
-- and this trigger is the only thing that writes it: whenever a row arrives or
-- changes with an address, the hash is recomputed from it, so a writer still
-- cannot pair an address with the hash of something else. A row with no
-- address (a suppressed one) keeps the hash it had, and a writer copying such
-- a row — `reconcile_contacts` splitting a contact for another identity —
-- supplies the hash itself.
--
-- A row cannot hold neither: the table's `email_contacts_address_kept` check
-- says the address is null exactly when the status is `suppressed`.
create or replace function private.apply_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tombstone private.email_suppressions;
begin
  if new.email_normalized is not null then
    new.email_hash := extensions.digest(new.email_normalized, 'sha256');
  end if;

  if tg_op = 'INSERT' then
    select * into tombstone from private.email_suppressions t
    where t.email_hash = new.email_hash;
    if found then
      new.status := 'suppressed';
      new.suppression_reason := tombstone.reason;
      new.suppressed_at := tombstone.suppressed_at;
      new.verified_at := null;
    end if;
  end if;

  if new.status = 'suppressed' then
    new.email_normalized := null;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_suppression() from public;
revoke all on function private.apply_suppression() from anon, authenticated;

-- supabase/sql/functions/private/reconcile_contacts.sql
-- ---------------------------------------------------------------------------
-- The address a membership is reachable at, when the membership changes hands.
--
-- Shared by `move_membership` (the destination has no membership here) and
-- `adopt_membership_rows` (it has one, and the duplicate is being retired),
-- because the work is the same either way and the first version of this ticket
-- had it in one and not the other — which left a retired duplicate's consent and
-- its emailed links bound to a membership that no longer exists.
--
-- Three rules, in order of how badly getting them wrong would hurt:
--
--   * **Only this circle's rows move.** A contact belongs to an identity and an
--     identity can be in several circles, so handing the contact over whole would
--     carry another circle's consent to an identity that is not a member of it.
--   * **A withdrawal survives a merge.** Where both identities hold consent for
--     one plan at one address, the result is withdrawn if *either* of them is.
--     Choosing by identity — "the destination's row is the one that persists" —
--     discards an unsubscribe, and unsubscribing is immediate here (§14, and the
--     Spam Act).
--   * **Queued mail is re-pointed before anything is deleted.** An email job names
--     a contact and carries no `user_id` at all, and
--     `notification_jobs_contact_fkey` is `on delete cascade`: the tidy-up would
--     otherwise take away messages somebody is waiting for, without a word.
-- ---------------------------------------------------------------------------

create or replace function private.reconcile_contacts(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact record;
  destination_contact uuid;
begin
  -- Before the contact is touched at all. Every branch below either moves the
  -- contact — whose `user_id` cascades into `email_action_tokens.membership_user_id`
  -- — or re-points the token's `contact_id`, and an unspent re-entry token arriving
  -- at a permanent identity is refused by `enforce_reentry_for_guests`. That
  -- refusal took the whole claim with it, which made saving your place impossible
  -- for exactly the people who had asked to be emailed.
  perform private.retire_reentry_links(p_circle_id, p_from, p_to);

  -- In the merge path `p_from` still holds its own membership here, and its links
  -- are about to name somebody else's long-standing one. A link just retired is made
  -- plain used, so that it can never take that membership back from its holder
  -- (ADR 0049 decision 6). In the move path the membership has already left `p_from`
  -- and the link is still the member's to use once.
  if exists (
    select 1 from public.circle_members m where m.circle_id = p_circle_id and m.user_id = p_from
  ) then
    update private.email_action_tokens t set retired_at = null
    where t.purpose = 'reentry' and t.membership_circle_id = p_circle_id
      and t.membership_user_id = p_from and t.retired_at is not null;
  end if;

  for contact in
    select ec.id, ec.email_hash,
      -- Whether this contact has anything outside the circle being moved, which
      -- decides both whether it is split and whether it survives the move.
      exists (
        select 1 from private.email_subscriptions other
        join public.plans pl on pl.id = other.plan_id
        where other.contact_id = ec.id and pl.circle_id <> p_circle_id
        union all
        select 1 from private.email_action_tokens other
        where other.contact_id = ec.id
          and other.membership_circle_id is not null
          and other.membership_circle_id <> p_circle_id
      ) as keeps_other_circles
    from private.email_contacts ec
    where ec.user_id = p_from
      -- One address only, when a place is being taken back from a saved account
      -- (`private.hand_back_membership` names it): the account's own addresses and
      -- anything else it attached stay with it. Unset, every contact of this circle
      -- moves, as for a guest-to-guest move. A client cannot set this, and setting
      -- it could only ever move *less*.
      and (
        nullif(current_setting('circles.takeback_email_hash', true), '') is null
        or ec.email_hash = decode(current_setting('circles.takeback_email_hash', true), 'hex')
      )
      and (
        exists (
          select 1 from private.email_subscriptions s
          join public.plans p on p.id = s.plan_id
          where s.contact_id = ec.id and p.circle_id = p_circle_id
        )
        or exists (
          select 1 from private.email_action_tokens t
          where t.contact_id = ec.id and t.membership_circle_id = p_circle_id
        )
      )
  loop
    select ec.id into destination_contact
    from private.email_contacts ec
    where ec.user_id = p_to and ec.email_hash = contact.email_hash;

    if not found then
      -- `is not null and <>` inside `keeps_other_circles`, not `is distinct from`. A
      -- `verify` or `prefs` token has no membership at all — the constraint on
      -- `email_action_tokens` requires it null for anything but `reentry` — and
      -- `null is distinct from <uuid>` is true, so every contact with a verification
      -- link outstanding looked like a contact tied to another circle. It was split
      -- instead of travelling: the consent went to a fresh copy with no links, the
      -- links stayed on an identity with no consent, and retention took both.
      if contact.keeps_other_circles then
        -- Split: a copy for the destination carrying the same address and the
        -- same standing — verified stays verified, because it is the same person
        -- and the same address, and suppressed stays suppressed, because that is
        -- global by hash (spec §9). Uniqueness is `(email_hash, user_id)`, so two
        -- identities holding one address is what 0009 made legal.
        insert into private.email_contacts
          (user_id, email_normalized, email_hash, status, verified_at, suppressed_at,
           suppression_reason)
        select p_to, ec.email_normalized, ec.email_hash, ec.status, ec.verified_at, ec.suppressed_at,
               ec.suppression_reason
        from private.email_contacts ec
        where ec.id = contact.id
        returning id into destination_contact;
      else
        -- Nothing outside this circle and nowhere to merge into: the contact
        -- itself travels, and everything hanging off it comes by cascade.
        update private.email_contacts ec set user_id = p_to where ec.id = contact.id;
        continue;
      end if;
    end if;

    -- An address this person has already verified stays verified. The split branch
    -- copies `status` and `verified_at` "because it is the same person and the same
    -- address", and the merge branch was re-pointing consent onto a `pending` row and
    -- leaving it pending — so saving your place could *unverify* an address, and
    -- retention's seven-day rule for pending contacts could then sweep the consent.
    --
    -- One direction only. A suppressed contact is never promoted: suppression is
    -- global by hash (spec §9), `record_suppression` keeps it that way, and "no
    -- automatic reactivation" is the rule.
    update private.email_contacts kept
    set status = 'verified', verified_at = coalesce(kept.verified_at, source.verified_at, now())
    from private.email_contacts source
    where kept.id = destination_contact
      and source.id = contact.id
      and kept.status = 'pending'
      and source.status = 'verified';

    -- Consent, where the destination already has some for the same plan. The
    -- unique index is on `(contact_id, scope, plan_id)`, so the two cannot simply
    -- both be re-pointed — and which one survives is not a question about
    -- identities.
    update private.email_subscriptions kept
    set status = 'withdrawn',
        withdrawn_at = coalesce(kept.withdrawn_at, source.withdrawn_at, now())
    from private.email_subscriptions source
    where kept.contact_id = destination_contact
      and source.contact_id = contact.id
      and source.scope = kept.scope
      and source.plan_id is not distinct from kept.plan_id
      and source.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
      -- Either side having withdrawn makes the answer withdrawn. A merge is not a
      -- new consent, and it must never be a way to undo an unsubscribe.
      and 'withdrawn' in (source.status, kept.status)
      and kept.status <> 'withdrawn';

    delete from private.email_subscriptions source
    where source.contact_id = contact.id
      and source.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id)
      and exists (
        select 1 from private.email_subscriptions kept
        where kept.contact_id = destination_contact
          and kept.scope = source.scope
          and kept.plan_id is not distinct from source.plan_id
      );

    update private.email_subscriptions sub
    set contact_id = destination_contact, user_id = p_to
    where sub.contact_id = contact.id
      and sub.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

    -- Two kinds of link, and they move differently.
    --
    -- A `reentry` token names a membership, so it takes the new identity with it.
    -- In the move path the cascade has already done that; in the duplicate-merge
    -- path the membership never moved, and leaving the token behind both breaks the
    -- composite foreign key — `(contact_id, membership_user_id)` must be a real
    -- `(id, user_id)` pair on `email_contacts` — and points an emailed link at a
    -- membership about to be removed.
    update private.email_action_tokens tok
    set contact_id = destination_contact, membership_user_id = p_to
    where tok.contact_id = contact.id
      and tok.purpose = 'reentry'
      and tok.membership_circle_id = p_circle_id;

    -- A `verify` or `prefs` token names no membership and must keep naming none
    -- (the `email_action_tokens_membership_for_reentry` constraint), but it is
    -- still this person's link to this address — the preferences page has to work
    -- without a sign-in (spec §5.8) and unsubscribing is immediate (§14).
    --
    -- So it follows the contact only when the contact is going away. A source that
    -- keeps another circle's consent keeps its own links too: moving them would
    -- leave *it* with consent nobody can verify or manage, which is the same defect
    -- the other way round. A person who ends up holding one address on two contacts
    -- needs verification to be by address rather than by row — written on SUS-34,
    -- which owns `verify-email-contact`.
    if not contact.keeps_other_circles then
      update private.email_action_tokens tok
      set contact_id = destination_contact
      where tok.contact_id = contact.id and tok.membership_circle_id is null;
    end if;

    update jobs.notification_jobs job
    set contact_id = destination_contact
    where job.contact_id = contact.id
      and job.sent_at is null
      and job.plan_id in (select pl.id from public.plans pl where pl.circle_id = p_circle_id);

    -- The old row goes only once nothing points at it any more. A contact still
    -- holding another circle's consent is that circle's, and stays.
    delete from private.email_contacts ec
    where ec.id = contact.id
      and not exists (select 1 from private.email_subscriptions sub where sub.contact_id = ec.id)
      and not exists (select 1 from private.email_action_tokens tok where tok.contact_id = ec.id)
      and not exists (select 1 from jobs.notification_jobs job where job.contact_id = ec.id);
  end loop;
end;
$$;

comment on function private.reconcile_contacts(uuid, uuid, uuid) is
  'Moves one circle''s email consent, links and queued mail from one identity to another, merging where both hold the address. A withdrawal survives the merge.';

revoke all on function private.reconcile_contacts(uuid, uuid, uuid) from public;
revoke all on function private.reconcile_contacts(uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/private/takeback_allowed.sql
-- ---------------------------------------------------------------------------
-- May an emailed re-entry link take a place back from a saved account?
-- (ADR 0049, decision 6; the founder's decision of 3 October 2026.)
--
-- A saved place is never *offered* by the list and never moved by a pick, and that
-- stays. This is the one exception, and it is for a person who proves the address
-- the place was reachable at: if somebody took a guest's place from the Continue-as
-- list and then saved it as their own account, the real guest's emailed link must
-- still get them back, or the takeover is permanent.
--
-- Yes only when all of these hold, and the answer is a plain boolean so that every
-- way of being unsure is a no:
--
--   * the holder really is a saved account, by `auth.users` (the record only the
--     auth server writes), not by a profile flag or a token that may be stale;
--   * the holder does not own the circle (an owner stays a member,
--     `enforce_owner_stays_member`, and handing a circle on is its own operation)
--     and does not organise a plan that is still open: the plan's guards want its
--     organiser to be a member, so taking the place would strand it until the
--     owner cancels it. The account keeps the place until then;
--   * **the link's address is one the place's first holder had.** Walking the
--     recorded moves back from the holder (through claims) there is a move made by
--     the list, and the address is one that a link was once minted for the place's
--     *first holder*: the identity nobody moved the place to (or, in a loop, the
--     earliest mover). `email_action_tokens.minted_for_user_id` records whom each
--     link was minted for and never moves with the place. That is the story this
--     rule is for: a guest's place was picked from the list and then saved, and the
--     link is to the guest's own mailbox. Without it, a link to a taker's own
--     mailbox (minted for somebody who held the place *later*) could take the place
--     from the real guest once she had saved it, whether she came back by email or
--     by picking her own name; a saved account has no link of its own to answer
--     with. Keyed on the address and not on the identity the link names, so a guest
--     who has changed identity (new device, an emailed return) and whose newest
--     letter is minted for her current one is still recognised;
--   * **the account's own address is not the link's address.** An account whose
--     email is the address the link was sent to is the same person, signed in, and
--     keeps the place. Compared lower-cased, against `auth.users.email` and every
--     address on the account's sign-in identities. An account with *no* address of
--     its own (a phone sign-in) has none to match, so the link is not the account
--     holder's and may take the place back.
-- ---------------------------------------------------------------------------

create or replace function private.takeback_allowed(
  p_circle_id uuid,
  p_holder uuid,
  p_contact_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from auth.users u where u.id = p_holder and not coalesce(u.is_anonymous, true)
    )
    and exists (select 1 from private.email_contacts k where k.id = p_contact_id)
    and not exists (
      select 1 from public.circles c where c.id = p_circle_id and c.owner_user_id = p_holder
    )
    and not exists (
      select 1 from public.plans pl
      where pl.circle_id = p_circle_id and pl.organiser_user_id = p_holder
        and pl.state not in ('cancelled', 'expired', 'completed')
    )
    and exists (
      with recursive chain (id, from_id, to_id, picked, at) as (
        select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
               a.action = 'circles.member_reattached'
                 and coalesce(a.metadata ->> 'source', 'list') = 'list',
               a.occurred_at
        from private.audit_log a
        where a.resource_type = 'circle' and a.resource_id = p_circle_id
          and a.action in ('circles.member_reattached', 'circles.member_claimed')
          and a.metadata ->> 'to_user_id' = p_holder::text
        union
        select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
               a.action = 'circles.member_reattached'
                 and coalesce(a.metadata ->> 'source', 'list') = 'list',
               a.occurred_at
        from private.audit_log a
        join chain on a.metadata ->> 'to_user_id' = chain.from_id
        where a.resource_type = 'circle' and a.resource_id = p_circle_id
          and a.action in ('circles.member_reattached', 'circles.member_claimed')
      ),
      firsts as (
        select c.from_id from chain c
        where not exists (select 1 from chain x where x.to_id = c.from_id)
        union
        select (select e.from_id from chain e order by e.at, e.id limit 1)
        where not exists (
          select 1 from chain c where not exists (select 1 from chain x where x.to_id = c.from_id)
        )
      )
      select 1
      where exists (select 1 from chain where picked)
        and exists (
          select 1
          from private.email_action_tokens t
          join private.email_contacts tk on tk.id = t.contact_id
          join private.email_contacts k on k.id = p_contact_id and k.email_hash = tk.email_hash
          where t.purpose = 'reentry' and t.membership_circle_id = p_circle_id
            and t.minted_for_user_id::text in (select f.from_id from firsts f)
        )
    )
    and not exists (
      select 1
      from private.email_contacts k
      where k.id = p_contact_id
        and (
          exists (
            select 1 from auth.users u
            where u.id = p_holder and extensions.digest(lower(btrim(u.email)), 'sha256') = k.email_hash
          )
          or exists (
            select 1 from auth.identities i
            where i.user_id = p_holder
              and extensions.digest(lower(btrim(i.identity_data ->> 'email')), 'sha256') = k.email_hash
          )
        )
    );
$$;

comment on function private.takeback_allowed(uuid, uuid, uuid) is
  'Whether an emailed re-entry link may take a place back from a saved account: a real account, not the circle''s owner or an open plan''s organiser, whose own address is not the link''s, and and whose place was picked from the first holder, whose address the link is. Every doubt is a no.';

revoke all on function private.takeback_allowed(uuid, uuid, uuid) from public;
revoke all on function private.takeback_allowed(uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/public/record_events.sql
-- ---------------------------------------------------------------------------
-- The write half of the analytics ingest.
--
-- In SQL rather than as a `.from('events').insert(...)` because `analytics` is
-- not a schema PostgREST exposes, and should not become one: the table grants
-- the service role `select, insert` and nothing else, and a client that could
-- reach it directly would be a client that could write its own history.
--
-- The validating half stays in TypeScript, where the catalogue is
-- (`packages/contracts/analytics.ts` — a Zod schema per event, per version).
-- This is deliberately dumb: it takes rows that have already been checked and
-- lands them. What it adds is the one thing only the database can promise —
-- `on conflict do nothing`, so a client that resends a batch it could not
-- confirm does not inflate a funnel.
--
-- `p_user_id` is a parameter rather than `auth.uid()` for the same reason
-- `request_email_updates`'s is: the caller is the service role, so there is no
-- session for the database to ask about, and the Edge Function above has
-- already verified the bearer it came from.
--
-- What it does *not* check is content, and that is not an omission: the table's
-- own `events_properties_carry_no_content` refuses a key or a value that could
-- carry somebody's words, which is §15's rule kept where a bug in this function
-- cannot get past it.
-- ---------------------------------------------------------------------------

create or replace function public.record_events(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into analytics.events (
    event_id, event_name, schema_version, user_id, anonymous_id,
    circle_id, plan_id, properties, occurred_at
  )
  select
    e.event_id, e.event_name, e.schema_version,
    -- A user who was deleted a moment ago still holds a bearer that verifies
    -- for the rest of its hour, and `events.user_id` is a foreign key that
    -- nulls on deletion (SUS-191). The event lands without the identity
    -- rather than failing the whole batch with it.
    case when exists (select 1 from auth.users u where u.id = e.user_id) then e.user_id end,
    e.anonymous_id,
    e.circle_id, e.plan_id, coalesce(e.properties, '{}'::jsonb), e.occurred_at
  from jsonb_to_recordset(p_rows) as e (
    event_id uuid,
    event_name text,
    schema_version integer,
    user_id uuid,
    anonymous_id text,
    circle_id uuid,
    plan_id uuid,
    properties jsonb,
    occurred_at timestamptz
  )
  on conflict (event_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.record_events(jsonb) is
  'Inserts already-validated analytics events, ignoring any whose event_id is already stored. Returns how many were new to the table. Service role only; the catalogue is the validation and lives in packages/contracts.';

revoke all on function public.record_events(jsonb) from public;
revoke all on function public.record_events(jsonb) from anon, authenticated;
grant execute on function public.record_events(jsonb) to service_role;

-- END GENERATED: function definitions
