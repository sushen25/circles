-- 0045_plan_creator_durable
--
-- Who started a named plan is recorded durably (SUS-177), so the founder
-- dashboard's "plans started by someone other than the owner" gate stops
-- depending on a 30-day outbox row or on the client's own `plan_created` event,
-- which can be lost (offline, blocked, a crash before the batch flushes).
--
-- Which record: a `private.audit_log` row, `plan.created`, and not a column on
-- `plans`. `plans` deliberately has no `created_by` (migration 0003): it is
-- readable by every member, and on a quiet ask the creator is the initiator.
-- The audit log is where 0003 said "who created a plan" belongs, no client
-- reads it, and `create_plan` already shares its transaction with the plan.
--
-- What this does:
--
--   * `create_plan` (below, generated) writes the row in the plan's own
--     transaction: the creator's id, the plan's id and the plan's creation
--     time. No name, no text. `create_quiet_ask` is untouched, so a quiet
--     ask's initiator stays where it was.
--   * `jobs.run_retention` (below, generated) no longer deletes `plan.created`
--     after 12 months, as it does every other audit row. The gate reads back to
--     400 days and a plan outlives a year, so the row is kept while the plan is,
--     and removed once the plan is gone (a circle's deletion cascades to it).
--   * Backfill for plans that exist now, from what the server still has: the
--     creation's outbox event (kept 30 days), else the client's `plan_created`
--     event. A plan with neither is left without a row: its creator is not
--     known, and its current organiser is not evidence (a hand-off moves it).
--   * `analytics.gate_other_organiser` reads the row and nothing else.

-- ---------------------------------------------------------------------------
-- 1. Backfill. Marked so the founder can tell a recorded fact from a recovered
--    one; the time is the plan's own.
-- ---------------------------------------------------------------------------
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata, occurred_at)
select src.creator, 'plan.created', 'plan', p.id,
       jsonb_build_object('backfilled', true, 'source', src.source), p.created_at
from public.plans p
cross join lateral (
  select u.creator, u.source
  from (
    select (o.payload ->> 'organiser_user_id')::uuid as creator, 'outbox' as source, 1 as rank
    from jobs.outbox o
    where o.aggregate_id = p.id and o.event_name = 'planning.plan_created'
    union all
    select e.user_id, 'client_event', 2
    from analytics.events e
    where e.plan_id = p.id and e.event_name = 'plan_created' and e.user_id is not null
  ) u
  where u.creator is not null
  order by u.rank
  limit 1
) src
where p.mode = 'named'
  and not exists (
    select 1 from private.audit_log a
    where a.action = 'plan.created' and a.resource_id = p.id
  );

-- ---------------------------------------------------------------------------
-- 2. The gate. Same columns as in 0043 (a day and a count).
-- ---------------------------------------------------------------------------
create or replace view analytics.gate_other_organiser as
select p.created_at::date as day, count(*) as plans
from public.plans p
join public.circles c on c.id = p.circle_id
where p.mode = 'named'
  and exists (
    select 1 from private.audit_log a
    where a.action = 'plan.created'
      and a.resource_type = 'plan'
      and a.resource_id = p.id
      and a.actor_user_id is not null
      and a.actor_user_id <> c.owner_user_id
  )
group by 1;

comment on view analytics.gate_other_organiser is
  'Named plans started by somebody other than the circle''s owner, by the day the plan was created. Who started a plan is its plan.created audit row, written with the plan and kept as long as it. Quiet asks are not counted.';

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
  n_audit_plans integer;
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
    and not exists (
      select 1 from auth.users u
      where u.id = c.user_id
        and u.email_confirmed_at is not null
        and c.email_hash = extensions.digest(lower(btrim(u.email)), 'sha256')
    )
    and not exists (
      select 1 from jobs.notification_jobs j
      where j.contact_id = c.id and j.status = 'scheduled'
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

-- supabase/sql/functions/public/create_plan.sql
-- ---------------------------------------------------------------------------
-- A plan comes into existence in `draft` and is moved out of it by the machine.
--
-- Not "insert with state `collecting`". `draft → create_named → collecting` is a
-- row in `planning.transitions`, with its guards (an active member, a saved
-- place — ADR 0004) and its event (`planning.plan_created`) attached to it. A
-- function that set the state itself would be a second creation path with its
-- own idea of who may create and whether anybody is told; `enforce_state_through_transition`
-- refuses that in any case. So: insert the draft, address it to people, hand it
-- to `transition_plan`. The seed has done it this way since 0003.
--
-- Everything arriving here is already resolved. The presets, the default
-- deadline and the default quorum are `packages/domain`'s — `resolvePreset`,
-- `defaultDeadline`, `quorumFor` — and the Edge Function applies them before
-- calling. This function does not second-guess those numbers; it records them,
-- and the table's own constraints (a viable band, a deadline before the last
-- possible start) are what stop an impossible plan.
--
-- The short code is generated here for the reason `create_circle` generates
-- one: a collision has to be retried against the table, which only the database
-- can see.
--
-- In `public`, although it is planning's work and calls planning's machine.
-- Two reasons, and either alone would settle it: PostgREST exposes `public` and
-- nothing else, so a function anywhere else cannot be called by a client at all;
-- and `070_communication_jobs.sql` asserts that *no* function outside `public` is
-- callable by a client role, which is the invariant that keeps `planning`,
-- `private` and `jobs` reachable only through functions like this one. What
-- stays in `planning` is what only SQL calls: `transition_plan`, `allowed_keys`,
-- `event_for`, `candidate_is_eligible`.
-- ---------------------------------------------------------------------------

create or replace function public.create_plan(
  p_circle_id uuid,
  p_title text,
  p_category text,
  p_window_start date,
  p_window_end date,
  p_daily_start_local integer,
  p_daily_end_local integer,
  p_duration_minutes integer,
  -- **Null means nobody chose.** The caller passes the organiser's number, or
  -- the circle's default, or nothing at all; what "nothing" resolves to is
  -- decided here, under the circle's lock, from the audience this plan is
  -- about to be addressed to (ADR 0026). Two reasons it is not the caller's
  -- (review round 5): a count read before the call is a count that can be
  -- stale by the time the rows are written, and this function is granted to
  -- `authenticated`, so a client calling it directly could otherwise label its
  -- own chosen number `defaulted` and have later joins overwrite it.
  p_quorum integer,
  p_response_deadline timestamptz,
  -- Absent means "the organiser alone", which is spec §5.3's default. An empty
  -- array is a different answer — nobody is required — and is kept as one.
  p_required_member_ids uuid[] default null,
  -- The days a custom plan asks about, when it has gaps (ADR 0047): sorted,
  -- distinct, and starting and ending on the window's ends. Null — every
  -- preset, and a custom range with no gap — means every day of the window,
  -- and so does a list that leaves no day out: it is stored as no rows.
  p_days date[] default null
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  caller uuid := (select auth.uid());
  circle public.circles;
  created public.plans;
  code text;
  i integer;
begin
  if caller is null then
    raise exception 'create_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- Locked, so that the participant list below is the roster the plan was
  -- actually addressed to rather than one that changed underneath it.
  select * into circle from public.circles c where c.id = p_circle_id for update;
  if not found then
    raise exception 'circle_not_found' using errcode = 'no_data_found';
  end if;

  if circle.status <> 'active' then
    -- An archived circle "stops all prompts" (spec §5.2), and a new plan is the
    -- loudest prompt there is.
    raise exception 'circle_archived' using errcode = 'check_violation';
  end if;

  -- The deadline's other end, checked where it is true. `plans_deadline` bounds
  -- it above and cannot bound it below: "not already past" is about now, which
  -- a check constraint may not read. The Edge Function asks the domain the same
  -- question a moment earlier, and a moment is exactly the problem — tonight's
  -- default can be the last possible start itself, so a deadline that was
  -- seconds away when the request was validated is seconds gone when the row is
  -- written, and the plan arrives with its replies already closed.
  if p_response_deadline <= now() then
    raise exception 'deadline_out_of_range' using errcode = 'P0001';
  end if;

  -- Refused rather than tidied, as the domain refuses it (`windowError`): a
  -- list out of order or not ending on the window's ends is a caller that
  -- has misunderstood which days it means.
  if planning.days_invalid(p_days, p_window_start, p_window_end) then
    raise exception 'days_invalid' using errcode = 'P0001';
  end if;

  -- The same alphabet as a circle's, and the same reason: a plan's code is read
  -- aloud and pasted into a chat (`/p/:code`), so no `o`, `l`, `i`, `0` or `1`.
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(
        alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)),
        1
      );
    end loop;
    exit when not exists (select 1 from public.plans p where p.short_code = code);
  end loop;

  insert into public.plans (
    circle_id, mode, organiser_user_id, title, category, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, quorum_source, response_deadline, short_code
  )
  values (
    p_circle_id, 'named', caller, p_title, p_category, circle.time_zone,
    p_window_start, p_window_end, p_daily_start_local, p_daily_end_local,
    p_duration_minutes,
    -- The request's number, then the circle's own default, then the rule. The
    -- circle's default is read here rather than taken from the caller for the
    -- same reason the label is (review round 6): this function is granted to
    -- `authenticated`, so a direct call with no quorum must not turn a circle
    -- that *has* chosen a default into a plan that follows the audience.
    coalesce(p_quorum, circle.default_quorum, public.soft_quorum((
      select count(*)::integer from public.circle_members m
      where m.circle_id = p_circle_id and m.status = 'active'
    ))),
    case
      when p_quorum is null and circle.default_quorum is null then 'defaulted'
      else 'chosen'
    end,
    p_response_deadline, code
  )
  returning * into created;

  -- Who it was addressed to: the circle's active members at this moment. A
  -- fact, not a derivation — somebody who joins on Tuesday is not a
  -- non-responder to a question asked on Monday (0003's own comment, and
  -- spec §9 makes joining an active plan an opt-in).
  -- Rows only for a window with gaps; `enforce_plan_days` holds that at commit.
  if p_days is not null and cardinality(p_days) < (p_window_end - p_window_start) + 1 then
    insert into public.plan_days (plan_id, day)
    select created.id, d from unnest(p_days) d;
  end if;

  insert into public.plan_participants (plan_id, revision, user_id)
  select created.id, created.revision, m.user_id
  from public.circle_members m
  where m.circle_id = p_circle_id and m.status = 'active';

  -- "The organiser is required by default" (spec §5.3). An explicit list
  -- replaces that rather than adding to it: an organiser who says "these three
  -- have to be there" has said something about themselves too.
  --
  -- Refused, not filtered. A list that quietly loses the member who left while
  -- the form was open produces a plan the organiser believes needs four people
  -- and that can be confirmed with three — and nothing anywhere says so.
  -- `revise_plan` refuses the same request for the same reason.
  if exists (
    select 1 from unnest(coalesce(p_required_member_ids, array[caller])) as required
    where not exists (
      select 1 from public.circle_members m
      where m.circle_id = p_circle_id and m.user_id = required and m.status = 'active'
    )
  ) then
    raise exception 'not_a_participant' using errcode = 'P0001';
  end if;

  -- `distinct`, because a list naming somebody twice is a list naming them, and
  -- the primary key would otherwise abort the whole creation over a repeat.
  insert into public.plan_required_members (plan_id, revision, user_id)
  select distinct created.id, created.revision, required
  from unnest(coalesce(p_required_member_ids, array[caller])) as required;

  -- And out of `draft` by the only route there is. The guards — an active
  -- member with a saved place, and no plan already `collecting` or `ready` in
  -- this circle (`plan_in_progress`, ADR 0033) — run here, so an anonymous
  -- caller's plan, or a second plan beside one still finding a time, is rolled
  -- back rather than left behind. The one-open-plan rule is the machine's and
  -- not repeated above: this function holds the circle's lock from the top, so
  -- the guard's own lock is the same one, and two "Ask the group" taps arriving
  -- together are decided one after the other.
  -- Who started it, durably (SUS-177). The outbox event says the same for 30
  -- days and the client's `plan_created` for as long as the client managed to
  -- send it; this is the record the founder's organiser gate reads. Ids and the
  -- moment, in the plan's own transaction, so a plan without it cannot exist.
  -- Named plans only: who starts a quiet ask stays in `private.plan_initiators`
  -- and `create_quiet_ask` does not come through here.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, occurred_at)
  values (caller, 'plan.created', 'plan', created.id, created.created_at);

  return planning.transition_plan(created.id, 'create_named', caller);
end;
$$;

comment on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) is
  'Creates a named plan as a draft, addresses it to the circle''s active members, and moves it to collecting through the state machine, and records who created it in private.audit_log (plan.created, kept as long as the plan). Defaults are resolved by the domain before it is called.';

revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) from public;
revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) from anon, authenticated;
grant execute on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) to authenticated;

-- END GENERATED: function definitions
