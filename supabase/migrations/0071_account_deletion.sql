-- 0071_account_deletion
--
-- S4-05 (ADR 0083): deleting an account, leaving a circle, exporting your data.
--
-- Numbered 0071 because #241 holds 0070; renumber if the merge order changes.
--
-- Schema, before the functions that rely on it:
--
--   * Four history columns that pointed at `auth.users` with no action now say
--     `on delete set null`, and the three that were `not null` are nullable:
--     `circle_invites.created_by`, `meetup_confirmations.confirmed_by` and
--     `outcome_reports.reported_by` are facts about a link, a time and an
--     outcome, and who pressed the button is history nothing reads to decide.
--     `plans.organiser_user_id` was already nullable (a quiet plan has no
--     organiser) and is the fourth. `circles.owner_user_id` stays `not null`
--     with no action: a circle has an owner until it is archived and purged.
--   * `private.account_deletions`: who has asked to go, and when the purge is
--     due. One row per person; the purge's cascade deletes it with the user.
--   * `identity.account_deleted` joins the outbox's event names.

alter table public.circle_invites alter column created_by drop not null;
alter table public.circle_invites drop constraint circle_invites_created_by_fkey;
alter table public.circle_invites
  add constraint circle_invites_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.meetup_confirmations alter column confirmed_by drop not null;
alter table public.meetup_confirmations drop constraint meetup_confirmations_confirmed_by_fkey;
alter table public.meetup_confirmations
  add constraint meetup_confirmations_confirmed_by_fkey
  foreign key (confirmed_by) references auth.users (id) on delete set null;

alter table public.outcome_reports alter column reported_by drop not null;
alter table public.outcome_reports drop constraint outcome_reports_reported_by_fkey;
alter table public.outcome_reports
  add constraint outcome_reports_reported_by_fkey
  foreign key (reported_by) references auth.users (id) on delete set null;

alter table public.plans drop constraint plans_organiser_user_id_fkey;
alter table public.plans
  add constraint plans_organiser_user_id_fkey
  foreign key (organiser_user_id) references auth.users (id) on delete set null;

create table private.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null default now() + interval '30 days'
);
alter table private.account_deletions enable row level security;
revoke all on private.account_deletions from public, anon, authenticated;
comment on table private.account_deletions is
  'People who asked to delete their account and when the purge is due (S4-05). Read by jobs.run_retention; deleted with the user by the purge.';

alter table jobs.outbox drop constraint outbox_event_name;
alter table jobs.outbox add constraint outbox_event_name check (event_name in (
-- BEGIN GENERATED: event names (scripts/gen-events.mjs)
    'circles.circle_created',
    'circles.member_joined',
    'circles.member_removed',
    'circles.invite_rotated',
    'circles.member_reattached',
    'planning.plan_created',
    'planning.plan_revised',
    'planning.plan_expired',
    'planning.plan_cancelled',
    'planning.quiet_ask_created',
    'planning.interest_recorded',
    'planning.threshold_reached',
    'planning.organiser_accepted',
    'planning.organiser_changed',
    'planning.deadline_passed',
    'availability.response_submitted',
    'availability.response_cleared',
    'scheduling.candidates_generated',
    'scheduling.no_eligible_candidates',
    'confirmation.meetup_confirmed',
    'confirmation.meetup_rescheduled',
    'confirmation.meetup_moved',
    'confirmation.meetup_cancelled',
    'confirmation.attendance_updated',
    'confirmation.outcome_reported',
    'communication.contact_verified',
    'communication.subscription_changed',
    'communication.delivery_recorded',
    'growth.nudge_shown',
    'growth.nudge_answered',
    'growth.account_claimed',
    'identity.account_deleted'
-- END GENERATED: event names
));

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
-- Each rule runs in its own subtransaction (`begin … exception … end`): a rule
-- that raises is rolled back alone, named in `failed_rules` in the run's audit
-- row, and the rest still run. Before S4-05 this was one transaction, and the
-- first foreign-key error in any rule would have stopped them all, every day.
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
  n_outbox integer := 0;
  n_jobs integer := 0;
  n_delivery integer := 0;
  n_invites integer := 0;
  n_tokens integer := 0;
  n_pending_contacts integer := 0;
  n_plan_contacts integer := 0;
  n_summaries integer := 0;
  n_summaries_purged integer := 0;
  n_windows_aged integer := 0;
  n_windows_gone integer := 0;
  n_anonymous integer := 0;
  n_requests integer := 0;
  n_counters integer := 0;
  n_audit integer := 0;
  n_audit_plans integer := 0;
  n_auth_audit integer := 0;
  n_accounts integer := 0;
  gone record;
  failed jsonb := '[]'::jsonb;
  result jsonb;
begin
  -- Outbox and pipeline bookkeeping: 30 days. An unprocessed outbox row is
  -- never deleted, however old — the health job reports it instead.
  begin
    delete from jobs.outbox where processed_at < now() - interval '30 days';
    get diagnostics n_outbox = row_count;
  exception when others then
    failed := failed || to_jsonb('outbox'::text);
    raise warning 'run_retention: rule outbox failed (%)', sqlstate;
  end;

  begin
    delete from jobs.notification_jobs where created_at < now() - interval '30 days';
    get diagnostics n_jobs = row_count;
  exception when others then
    failed := failed || to_jsonb('notification_jobs'::text);
    raise warning 'run_retention: rule notification_jobs failed (%)', sqlstate;
  end;

  begin
    delete from private.email_delivery_events where recorded_at < now() - interval '30 days';
    get diagnostics n_delivery = row_count;
  exception when others then
    failed := failed || to_jsonb('delivery_events'::text);
    raise warning 'run_retention: rule delivery_events failed (%)', sqlstate;
  end;

  -- Revoked invite hashes: 30 days.
  begin
    delete from public.circle_invites where revoked_at < now() - interval '30 days';
    get diagnostics n_invites = row_count;
  exception when others then
    failed := failed || to_jsonb('revoked_invites'::text);
    raise warning 'run_retention: rule revoked_invites failed (%)', sqlstate;
  end;

  -- Expired or used tokens: 7 days after they stopped being usable.
  begin
    delete from private.email_action_tokens
    where expires_at < now() - interval '7 days'
       or used_at < now() - interval '7 days';
    get diagnostics n_tokens = row_count;
  exception when others then
    failed := failed || to_jsonb('expired_action_links'::text);
    raise warning 'run_retention: rule expired_action_links failed (%)', sqlstate;
  end;

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
  begin
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
  exception when others then
    failed := failed || to_jsonb('pending_contacts'::text);
    raise warning 'run_retention: rule pending_contacts failed (%)', sqlstate;
  end;

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
  begin
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
  exception when others then
    failed := failed || to_jsonb('plan_only_contacts'::text);
    raise warning 'run_retention: rule plan_only_contacts failed (%)', sqlstate;
  end;

  -- Willing windows, rule one (ADR 0005): 12 months, for members of active
  -- circles — after the summary is written, from everything still stored,
  -- so that what the member usually offers survives the windows going.
  -- Dropped first: two runs in one transaction (a test, a retry) would
  -- otherwise meet their own table.
  begin
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
  exception when others then
    failed := failed || to_jsonb('windows_aged'::text);
    raise warning 'run_retention: rule windows_aged failed (%)', sqlstate;
  end;

  -- Willing windows, rule two: 30 days after removal or archiving. No summary
  -- — a removed member's pre-fill is nobody's to keep — and the summary that
  -- was written while they were a member goes with the windows.
  begin
    delete from public.member_dayparts d
    using public.circle_members m, public.circles c
    where m.circle_id = d.circle_id and m.user_id = d.user_id
      and c.id = d.circle_id
      and (
        (m.status = 'removed' and m.updated_at < now() - interval '30 days')
        or (c.status = 'archived' and c.updated_at < now() - interval '30 days')
      );
    get diagnostics n_summaries_purged = row_count;
  exception when others then
    failed := failed || to_jsonb('daypart_summaries_purged'::text);
    raise warning 'run_retention: rule daypart_summaries_purged failed (%)', sqlstate;
  end;

  begin
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
  exception when others then
    failed := failed || to_jsonb('windows_of_the_gone'::text);
    raise warning 'run_retention: rule windows_of_the_gone failed (%)', sqlstate;
  end;

  -- Abandoned anonymous identities: a guest session that never joined
  -- anything, 30 days on. The cascade takes the profile.
  begin
    delete from auth.users u
    where coalesce(u.is_anonymous, false)
      and u.created_at < now() - interval '30 days'
      and not exists (select 1 from public.circle_members m where m.user_id = u.id);
    get diagnostics n_anonymous = row_count;
  exception when others then
    failed := failed || to_jsonb('anonymous_identities'::text);
    raise warning 'run_retention: rule anonymous_identities failed (%)', sqlstate;
  end;

  -- The Edge Function kit's own bookkeeping (S1-13). Both of these are written
  -- on every request and read only by the request after it, so without a rule
  -- they are the two tables in the schema that grow forever.
  --
  -- Seven days for a served request, which is a retry window with a great deal
  -- of room in it: a client that has not retried inside a week is a client that
  -- has moved on, and the mutations themselves are idempotent by their own state
  -- anyway. An *unfinished* one is kept, however old — it means a function died
  -- between claiming a key and answering, and that is worth being able to find.
  begin
    delete from jobs.idempotent_requests
    where status = 'done' and completed_at < now() - interval '7 days';
    get diagnostics n_requests = row_count;
  exception when others then
    failed := failed || to_jsonb('served_requests'::text);
    raise warning 'run_retention: rule served_requests failed (%)', sqlstate;
  end;

  -- A counter outside its own window can never be read again: `take_rate_token`
  -- computes `window_start` from the clock and only ever touches the current
  -- one. A day's grace, so that nothing is deleted while it is still counting.
  begin
    delete from jobs.rate_counters where window_start < now() - interval '1 day';
    get diagnostics n_counters = row_count;
  exception when others then
    failed := failed || to_jsonb('rate_counters'::text);
    raise warning 'run_retention: rule rate_counters failed (%)', sqlstate;
  end;

  -- Audit log: 12 months, except who started a plan (below).
  -- `plan.created` (who started a plan, SUS-177) is not a 12-month fact: the
  -- founder's organiser gate reads it for as long as the plan exists. It goes
  -- when the plan does (a circle's deletion cascades to its plans), and not
  -- before.
  begin
    delete from private.audit_log
    where occurred_at < now() - interval '12 months' and action <> 'plan.created';
    get diagnostics n_audit = row_count;

    delete from private.audit_log a
    where a.action = 'plan.created'
      and not exists (select 1 from public.plans p where p.id = a.resource_id);
    get diagnostics n_audit_plans = row_count;
    n_audit := n_audit + n_audit_plans;
  exception when others then
    failed := failed || to_jsonb('audit_rows'::text);
    raise warning 'run_retention: rule audit_rows failed (%)', sqlstate;
  end;

  -- GoTrue's own audit log: 90 days. It records every sign-in with the address
  -- that signed in, in clear, so it is bounded far shorter than ours. Its
  -- `created_at` is not indexed; the daily run deletes one day's worth, and the
  -- first run after this rule shipped deletes the backlog in one statement.
  begin
    delete from auth.audit_log_entries where created_at < now() - interval '90 days';
    get diagnostics n_auth_audit = row_count;
  exception when others then
    failed := failed || to_jsonb('auth_audit_entries'::text);
    raise warning 'run_retention: rule auth_audit_entries failed (%)', sqlstate;
  end;

  -- Accounts whose thirty days are up (S4-05, ADR 0083). One subtransaction
  -- per person, so a purge that fails holds up neither the others nor the rules
  -- above; the failing one is named in the run and tried again tomorrow.
  for gone in
    select d.user_id from private.account_deletions d
    where d.purge_after <= now()
    order by d.purge_after, d.user_id
  loop
    begin
      perform private.purge_account(gone.user_id);
      n_accounts := n_accounts + 1;
    exception when others then
      failed := failed || to_jsonb('account_purge'::text);
      raise warning 'run_retention: rule account_purge failed (%)', sqlstate;
    end;
  end loop;

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
    'auth_audit_entries', n_auth_audit,
    'accounts_purged', n_accounts,
    -- The rules that raised and were rolled back on their own. Empty on a good
    -- day; a name here means that rule's rows are still there and were tried
    -- again on the next run, and every other rule ran.
    'failed_rules', failed
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

-- supabase/sql/functions/private/purge_account.sql
-- ---------------------------------------------------------------------------
-- The end of an account deletion: thirty days on (S4-05, ADR 0083).
--
-- `public.delete_account` took the person out of every circle and signed them
-- out. This is the part that makes "nothing identifies them" true:
--
--   * circles they still own are deleted with their plans (an owner with nobody
--     to hand a circle to archived it; the auth user cannot go while
--     `circles.owner_user_id` points at it, and a circle with no owner and no
--     members is nothing anyone could open);
--   * the user's id is taken out of the places that hold it with no foreign key
--     to follow it: the audit log's actor, the audit rows about the account, and
--     the lists of who was free for a time;
--   * the auth user is deleted, and the cascade takes the profile, memberships,
--     attendance, nudge states, devices, contacts and everything else that
--     references it. The five history columns that used to block this
--     (`circle_invites.created_by`, `plans.organiser_user_id`,
--     `meetup_confirmations.confirmed_by`, `outcome_reports.reported_by`) now
--     `set null`, and `analytics.events.user_id` already did: the facts stay,
--     who they were about does not.
--
-- Called once per user from `jobs.run_retention`, each inside its own
-- subtransaction, so one person whose purge fails does not hold up the rest.
-- ---------------------------------------------------------------------------

create or replace function private.purge_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.circles c where c.owner_user_id = p_user_id;

  delete from jobs.outbox o where o.aggregate_type = 'account' and o.aggregate_id = p_user_id;

  update private.audit_log a set actor_user_id = null where a.actor_user_id = p_user_id;
  update private.audit_log a set resource_id = null
  where a.resource_type = 'account' and a.resource_id = p_user_id;
  update private.audit_log a set metadata = a.metadata - 'user_id'
  where a.metadata ->> 'user_id' = p_user_id::text;

  update public.meetup_confirmations k
  set available_user_ids = array_remove(k.available_user_ids, p_user_id)
  where k.available_user_ids @> array[p_user_id];
  update public.candidates c
  set available_user_ids = array_remove(c.available_user_ids, p_user_id)
  where c.available_user_ids @> array[p_user_id];

  delete from auth.users u where u.id = p_user_id;
end;
$$;

comment on function private.purge_account(uuid) is
  'Deletes an account whose thirty days are up: owned circles, the id in the logs and lists with no foreign key, then the auth user and its cascade (S4-05, ADR 0083). Only jobs.run_retention calls it.';

revoke all on function private.purge_account(uuid) from public;
revoke all on function private.purge_account(uuid) from anon, authenticated;

-- supabase/sql/functions/public/account_deletion_preview.sql
-- What deleting the account would do to the circles its owner is about to
-- leave, so the screen can say it before asking (S4-05, ADR 0083). One row per
-- circle the caller owns: who it would go to, or null when it would be
-- archived. The same choice `delete_account` makes, read, not written; a
-- member of the circle sees the heir's name on the roster anyway.

create or replace function public.account_deletion_preview()
returns table (circle_id uuid, circle_name text, heir_display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name,
    (
      select m.display_name_snapshot
      from public.circle_members m
      join public.profiles p on p.user_id = m.user_id
      where m.circle_id = c.id and m.status = 'active'
        and m.user_id <> c.owner_user_id and p.is_permanent
      order by m.joined_at, m.user_id
      limit 1
    )
  from public.circles c
  where c.owner_user_id = (select auth.uid()) and c.status = 'active'
  order by c.created_at, c.id;
$$;

comment on function public.account_deletion_preview() is
  'The circles the caller owns and, for each, who would inherit it on account deletion or null when it would be archived (S4-05).';

revoke all on function public.account_deletion_preview() from public;
revoke all on function public.account_deletion_preview() from anon, authenticated;
grant execute on function public.account_deletion_preview() to authenticated;

-- supabase/sql/functions/public/delete_account.sql
-- ---------------------------------------------------------------------------
-- Deleting an account (spec §12, §13; architecture §9.1; S4-05, ADR 0083).
--
-- "Delete my account and data": a permanent identity asks to go, and from the
-- moment this returns they are gone to everybody else and to the product, and
-- nothing identifies them to anybody but us for thirty days. The thirty days
-- end in `private.purge_account`, run by `jobs.run_retention`, which deletes
-- the profile, the `private.*` rows and the auth user itself.
--
-- All of it is one transaction, because half a deletion is the worst outcome:
-- somebody who has been told they are deleted and can still sign in.
--
--   1. Circles they own. A circle always has an owner while it is active, so it
--      is handed to the longest-standing permanent member, or archived when
--      there is none (and deleted with the account at the purge). The UI asks
--      first and shows which of the two will happen (`account_deletion_preview`).
--   2. Plans they organise go to the longest-standing member who could organise
--      one (an active, permanent participant of the current revision), or to
--      nobody: a plan with no organiser is a legal state already (the quiet
--      ask), and nothing is cancelled in silence.
--   3. Memberships end as the owner's Remove ends them, so
--      `public.on_member_removed` does what it always does (answers and windows
--      deleted, input versions bumped, a ready plan back to collecting, a meetup
--      still ahead stops counting them) and the name other members see becomes
--      'Former member'. The caller recalculates the plans returned.
--   4. Email: subscriptions withdrawn, letters still waiting skipped, and their
--      contacts deleted (not suppressed: a suppression is a tombstone for the
--      *address*, and would silence a person who comes back). Push devices are
--      disabled.
--   5. Sign-in: sessions deleted and the user banned, here, in the same
--      transaction, so "cannot sign in" does not depend on a second call
--      succeeding. The Edge Function also revokes the session through the auth
--      API; this is the part that cannot be skipped.
--
-- Safe to repeat: a second call finds the account already deleting and returns
-- the same shape with nothing left to do.
-- ---------------------------------------------------------------------------

create or replace function public.delete_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  owned record;
  mine record;
  heir uuid;
  new_organiser uuid;
  n_transferred integer := 0;
  n_archived integer := 0;
  stale uuid[] := '{}';
begin
  if caller is null then
    raise exception 'delete_account requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.auth_is_permanent() then
    raise exception 'requires_saved_place' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from private.account_deletions d where d.user_id = caller) then
    return jsonb_build_object('stale_plans', '[]'::jsonb, 'transferred', 0, 'archived', 0);
  end if;

  -- 1. Circles they own, in id order so two deletions racing cannot deadlock.
  for owned in
    select c.id from public.circles c
    where c.owner_user_id = caller and c.status = 'active'
    order by c.id
    for update
  loop
    select m.user_id into heir
    from public.circle_members m
    join public.profiles p on p.user_id = m.user_id
    where m.circle_id = owned.id and m.status = 'active'
      and m.user_id <> caller and p.is_permanent
    order by m.joined_at, m.user_id
    limit 1;

    if heir is null then
      update public.circles set status = 'archived' where id = owned.id;
      n_archived := n_archived + 1;
    else
      update public.circles set owner_user_id = heir where id = owned.id;
      update public.circle_members set role = 'owner'
        where circle_id = owned.id and user_id = heir;
      update public.circle_members set role = 'member'
        where circle_id = owned.id and user_id = caller;
      n_transferred := n_transferred + 1;
    end if;
  end loop;

  -- 2. Plans they organise that still have a future.
  for mine in
    select p.id, p.circle_id, p.revision
    from public.plans p
    join public.circles c on c.id = p.circle_id
    where p.organiser_user_id = caller
      and c.status = 'active'
      and p.state in ('collecting', 'ready', 'confirmed')
    order by p.id
  loop
    select m.user_id into new_organiser
    from public.circle_members m
    join public.profiles pr on pr.user_id = m.user_id
    join public.plan_participants pp
      on pp.plan_id = mine.id and pp.revision = mine.revision and pp.user_id = m.user_id
    where m.circle_id = mine.circle_id and m.status = 'active'
      and m.user_id <> caller and pr.is_permanent
    order by m.joined_at, m.user_id
    limit 1;

    update public.plans set organiser_user_id = new_organiser where id = mine.id;
  end loop;

  -- 3. Memberships. The trigger does the rest of removal.
  update public.circle_members m
  set status = 'removed', display_name_snapshot = 'Former member', updated_at = now()
  where m.user_id = caller and m.status = 'active';

  -- Rows that were removed long ago carry the name too.
  update public.circle_members m
  set display_name_snapshot = 'Former member', updated_at = now()
  where m.user_id = caller and m.display_name_snapshot <> 'Former member';

  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into stale
  from public.plans p
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = caller
  where p.state in ('collecting', 'ready');

  -- 4. Email and push.
  update private.email_subscriptions s
  set status = 'withdrawn', withdrawn_at = now()
  where s.user_id = caller and s.status = 'active';

  update jobs.notification_jobs j
  set status = 'skipped', last_error = 'account_deleted', updated_at = now()
  where j.status = 'scheduled'
    and (j.user_id = caller
         or j.contact_id in (select c.id from private.email_contacts c where c.user_id = caller));

  delete from private.email_contacts c where c.user_id = caller;

  update private.push_devices d set enabled = false where d.user_id = caller;

  -- 5. Sign-in. A hundred years is "for ever" to the auth server, which reads
  -- `banned_until` as a time; the purge deletes the user outright.
  delete from auth.sessions s where s.user_id = caller;
  update auth.users u set banned_until = now() + interval '100 years' where u.id = caller;

  insert into private.account_deletions (user_id) values (caller);

  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'identity.account_deleted', 'account', caller,
          jsonb_build_object('transferred', n_transferred, 'archived', n_archived));
  perform jobs.emit('identity.account_deleted', 'account', caller, '{}'::jsonb);

  return jsonb_build_object(
    'stale_plans', to_jsonb(stale),
    'transferred', n_transferred,
    'archived', n_archived
  );
end;
$$;

comment on function public.delete_account() is
  'Deletes the calling permanent identity now and the rest in thirty days (S4-05, ADR 0083): owned circles handed on or archived, memberships ended as a removal, email withdrawn and contacts deleted, sessions gone and the user banned. Returns the plans to recalculate.';

revoke all on function public.delete_account() from public;
revoke all on function public.delete_account() from anon, authenticated;
grant execute on function public.delete_account() to authenticated;

-- supabase/sql/functions/public/enforce_owner_stays_member.sql
-- The same invariant from the other side.
--
-- Watching `circles` alone leaves it true only at the moment a circle is
-- created: removing the owner's membership later empties the ownership without
-- touching the circles row, `auth_is_owner` goes permanently false, and every
-- owner-only operation on that circle is refused for good. An owner who wants
-- out hands the circle over first — that is a real operation with its own
-- checks (spec §9), not a side effect of leaving.

create or replace function public.enforce_owner_stays_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_circle uuid := coalesce(new.circle_id, old.circle_id);
  row_user uuid := coalesce(new.user_id, old.user_id);
begin
  -- The circle itself may have gone in this transaction, taking its members
  -- with it. Nothing to protect then. Nor for an archived circle: an owner who
  -- deletes their account with nobody to hand the circle to archives it first
  -- (ADR 0083), and an archived circle needs no owner to act, only one to name
  -- until the purge deletes the circle with them.
  if not exists (
    select 1 from public.circles c
    where c.id = row_circle and c.owner_user_id = row_user and c.status = 'active'
  ) then
    return null;
  end if;

  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = row_circle and m.user_id = row_user and m.status = 'active'
  ) then
    raise exception 'circle % cannot remove its owner %; hand the circle over first',
      row_circle, row_user
      using errcode = 'foreign_key_violation';
  end if;

  return null;
end;
$$;

comment on function public.enforce_owner_stays_member() is
  'An owner stays an active member. Deferred, so a hand-off may change the owner and the membership in either order within one transaction.';

revoke all on function public.enforce_owner_stays_member() from public;
revoke all on function public.enforce_owner_stays_member() from anon, authenticated;

-- supabase/sql/functions/public/export_my_data.sql
-- ---------------------------------------------------------------------------
-- "Export my data" (spec §13; architecture §9.1; S4-05, ADR 0083).
--
-- The caller's own data as one JSON document, and nobody else's. It is written
-- as a list of what is *theirs* — rows keyed on their own user id — rather than
-- as "everything in a circle minus what they should not see", because the
-- second shape leaks the day a column is added and the first leaks nothing it
-- was not told about.
--
--   * No other member appears: no id, no name, no address. Circle names are
--     given only for circles they are still in, and a plan's title only for a
--     plan they organise; a plan they answered is a plan id and a category.
--   * Their address is the hint (`m…@example.com`), the same as Account shows.
--     Push tokens are not exported: a device token is a credential, not a fact
--     about the person.
--   * `available_user_ids` on a confirmation, `plan_initiators` and the
--     quiet-ask tallies are other people's or the circle's, not theirs.
--
-- One export a day: the limit is here, not only in the Edge Function, because
-- the function is callable directly and a limit that lives only in the caller
-- is not one.
-- ---------------------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  hint text;
  doc jsonb;
begin
  if me is null then
    raise exception 'export_my_data requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.take_rate_token(
    'export_my_data', extensions.digest(me::text, 'sha256'), 1, interval '1 day'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  select public.own_email_hint() into hint;

  select jsonb_build_object(
    'exported_at', now(),
    'account', (
      select jsonb_build_object(
        'display_name', p.display_name,
        'time_zone', p.time_zone,
        'saved_place', p.is_permanent,
        'created_at', p.created_at,
        'email_hint', hint,
        'organiser_email_muted', p.muted_organiser_email
      ) from public.profiles p where p.user_id = me
    ),
    'circles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', m.circle_id,
        'circle_name', case when m.status = 'active' then c.name end,
        'my_name_there', m.display_name_snapshot,
        'role', m.role,
        'status', m.status,
        'joined_at', m.joined_at,
        'muted_quiet_asks', m.muted_quiet_asks,
        'muted_nudges', m.muted_nudges,
        'muted_all', m.muted_all
      ) order by m.joined_at, m.circle_id)
      from public.circle_members m
      join public.circles c on c.id = m.circle_id
      where m.user_id = me
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', r.plan_id,
        'revision', r.revision,
        'answer', r.status,
        'submitted_at', r.submitted_at,
        'used_calendar_overlay', r.used_calendar_overlay,
        'windows', coalesce((
          select jsonb_agg(jsonb_build_object('starts_at', w.starts_at, 'ends_at', w.ends_at)
                           order by w.starts_at)
          from public.willing_windows w where w.response_id = r.id
        ), '[]'::jsonb)
      ) order by r.submitted_at, r.id)
      from public.plan_responses r where r.user_id = me
    ), '[]'::jsonb),
    'usual_times', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', d.circle_id, 'summary', d.summary, 'computed_at', d.computed_at
      ) order by d.circle_id)
      from public.member_dayparts d where d.user_id = me
    ), '[]'::jsonb),
    'quiet_ask_answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', i.plan_id, 'answer', i.response, 'answered_at', i.responded_at
      ) order by i.responded_at, i.plan_id)
      from private.plan_interest i where i.user_id = me
    ), '[]'::jsonb),
    'plans_i_organise', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', p.id, 'title', p.title, 'state', p.state,
        'window_start', p.window_start, 'window_end', p.window_end
      ) order by p.created_at, p.id)
      from public.plans p where p.organiser_user_id = me
    ), '[]'::jsonb),
    'meetups_i_confirmed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', k.id, 'plan_id', k.plan_id,
        'starts_at', k.starts_at, 'ends_at', k.ends_at,
        'place_name', k.place_name, 'note', k.note, 'confirmed_at', k.confirmed_at
      ) order by k.confirmed_at, k.id)
      from public.meetup_confirmations k where k.confirmed_by = me
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', a.confirmation_id, 'status', a.status, 'updated_at', a.updated_at
      ) order by a.updated_at, a.confirmation_id)
      from public.attendance a where a.user_id = me
    ), '[]'::jsonb),
    'outcome_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', o.confirmation_id, 'outcome', o.outcome, 'note', o.note,
        'moved_outside', o.moved_outside, 'reported_at', o.reported_at
      ) order by o.reported_at, o.id)
      from public.outcome_reports o where o.reported_by = me
    ), '[]'::jsonb),
    'nudges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'moment', n.moment, 'plan_id', n.plan_id, 'shown_at', n.shown_at,
        'answer', n.answer, 'snoozed_until', n.snoozed_until, 'answered_at', n.answered_at
      ) order by n.shown_at, n.id)
      from public.nudge_states n where n.user_id = me
    ), '[]'::jsonb),
    'email', jsonb_build_object(
      'contacts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', c.status, 'address_hint', hint,
          'verified_at', c.verified_at, 'suppressed_at', c.suppressed_at
        ) order by c.created_at, c.id)
        from private.email_contacts c where c.user_id = me
      ), '[]'::jsonb),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'scope', s.scope, 'plan_id', s.plan_id, 'status', s.status,
          'consented_at', s.consented_at, 'withdrawn_at', s.withdrawn_at,
          'consent_text_version', s.consent_text_version
        ) order by s.consented_at, s.id)
        from private.email_subscriptions s where s.user_id = me
      ), '[]'::jsonb)
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'platform', d.platform, 'enabled', d.enabled, 'added_at', d.created_at
      ) order by d.created_at, d.id)
      from private.push_devices d where d.user_id = me
    ), '[]'::jsonb)
  ) into doc;

  return doc;
end;
$$;

comment on function public.export_my_data() is
  'The caller''s own data as one JSON document, and nobody else''s; one a day (S4-05, ADR 0083).';

revoke all on function public.export_my_data() from public;
revoke all on function public.export_my_data() from anon, authenticated;
grant execute on function public.export_my_data() to authenticated;

-- supabase/sql/functions/public/leave_circle.sql
-- ---------------------------------------------------------------------------
-- Leaving a circle (spec §4.5, §13; S4-05, ADR 0083).
--
-- Any active member, guests included, takes themselves out: the owner's Remove
-- done by the person it is done to. `public.on_member_removed` decides what
-- follows exactly as it does for the owner's Remove, so a leaver's answers to
-- plans still asking go, those plans' input versions are bumped, and the
-- function returns them for the caller to recalculate.
--
-- The owner cannot leave. A circle has an owner while it is active, and handing
-- it on is not this operation; an owner who wants out deletes their account,
-- which does hand it on (or archives it) after asking.
--
-- The name stays on the row, as it does after a Remove: history the circle's
-- other members saw ("Sam said they were free") reads the same afterwards.
-- ---------------------------------------------------------------------------

create or replace function public.leave_circle(p_circle_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  stale uuid[];
begin
  if caller is null then
    raise exception 'leave_circle requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.circles c where c.id = p_circle_id for update;

  if exists (
    select 1 from public.circles c where c.id = p_circle_id and c.owner_user_id = caller
  ) then
    raise exception 'owner_cannot_leave' using errcode = 'check_violation';
  end if;

  update public.circle_members m
  set status = 'removed', updated_at = now()
  where m.circle_id = p_circle_id and m.user_id = caller and m.status = 'active';

  if not found then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_left', 'circle', p_circle_id, '{}'::jsonb);

  select coalesce(array_agg(p.id order by p.created_at), '{}'::uuid[]) into stale
  from public.plans p
  where p.circle_id = p_circle_id and p.state in ('collecting', 'ready');

  return stale;
end;
$$;

comment on function public.leave_circle(uuid) is
  'The caller takes themselves out of a circle, as the owner''s Remove would; returns the plans to recalculate. Refused for the owner (S4-05).';

revoke all on function public.leave_circle(uuid) from public;
revoke all on function public.leave_circle(uuid) from anon, authenticated;
grant execute on function public.leave_circle(uuid) to authenticated;

-- END GENERATED: function definitions
