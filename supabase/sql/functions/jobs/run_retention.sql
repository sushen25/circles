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
