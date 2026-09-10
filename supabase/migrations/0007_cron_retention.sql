-- Scheduled work: the cron schedule, the lease it runs under, retention, and
-- the day-part summary that outlives the windows it was made from.
--
-- Cron is the only trigger for time-based work (ADR 0003, §9.3): nothing in
-- this system keeps an in-memory timer. Two jobs. Every minute, pg_cron asks
-- `process-scheduled-jobs` to run, through pg_net, under a lease so that two
-- invocations a minute apart cannot overlap. Daily at 03:15, it runs the
-- retention rules of §8.5 and ADR 0005 — as the owner, in the database,
-- because most of what retention deletes is in schemas the service role
-- cannot delete from by design (0006).
--
-- Nothing here holds an environment's URL or secret. Those are database
-- settings set after deploy (`docs/runbooks/environments.md`), and the job
-- does nothing until they exist.

-- ---------------------------------------------------------------------------
-- The lease.
--
-- One row per job name (0006). Taking it is one statement: an insert that
-- turns into an update only when the previous lease has lapsed, so two
-- callers racing for it cannot both win — the row lock decides, not the
-- clock they each read.
-- ---------------------------------------------------------------------------

create or replace function jobs.acquire_lease(p_name text, p_ttl interval, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  acquired boolean;
begin
  if p_ttl <= interval '0' then
    raise exception 'lease ttl must be positive' using errcode = 'check_violation';
  end if;

  insert into jobs.cron_leases as l (name, leased_until, holder, last_started_at)
  values (p_name, now() + p_ttl, p_holder, now())
  on conflict (name) do update
    set leased_until = excluded.leased_until,
        holder = excluded.holder,
        last_started_at = excluded.last_started_at
    where l.leased_until is null or l.leased_until < now()
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

comment on function jobs.acquire_lease(text, interval, text) is
  'True when the caller now holds the named lease until now() + ttl. False while somebody else holds it. One statement, so a race has one winner.';

create or replace function jobs.release_lease(p_name text, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  -- Only the holder releases. A late finisher whose lease has already been
  -- taken over must not release the new holder's.
  update jobs.cron_leases l
  set leased_until = null, last_finished_at = now()
  where l.name = p_name and l.holder = p_holder and l.leased_until is not null
  returning true into released;
  return coalesce(released, false);
end;
$$;

comment on function jobs.release_lease(text, text) is
  'Releases the named lease if the caller holds it. False otherwise — a lease that lapsed and was taken by another holder stays theirs.';

-- The names the schedule below uses, so a lease row exists before the first
-- run and the health job has something to read.
insert into jobs.cron_leases (name) values ('process_scheduled_jobs'), ('retention_daily')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- The day-part summary (ADR 0005).
--
-- "Weekday evenings, weekend afternoons": a coarse, per-member, per-circle
-- account of what somebody has offered, derived before their raw windows are
-- deleted and used only to pre-fill their own next response. Never to score a
-- member who has not answered.
--
-- The shape is `DayPartSummary` from packages/domain/availability/dayparts.ts
-- without its `userId`: `{parts: [...most offered first], counts: {...}}`. The
-- rule is `dayPartsCovered`: a window is attributed to every band it covers
-- — morning < 12:00, afternoon 12:00–17:00, evening from 17:00 — in the
-- plan's own zone, weekend by the local date it starts on, with a window that
-- ends at local midnight counted to the day it began. Same numbers, same
-- order, or the pre-fill would disagree with what the client computes.
-- ---------------------------------------------------------------------------

create table public.member_dayparts (
  circle_id uuid not null,
  user_id uuid not null,
  summary jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (circle_id, user_id),
  -- Follows the membership when a re-entry moves it to a new identity (0006).
  foreign key (circle_id, user_id) references public.circle_members (circle_id, user_id)
    on delete cascade on update cascade,
  constraint member_dayparts_summary_shape check (
    jsonb_typeof(summary -> 'parts') = 'array' and jsonb_typeof(summary -> 'counts') = 'object'
  )
);

comment on table public.member_dayparts is
  'What a member usually offers, per circle — derived from their windows before retention deletes them (ADR 0005). Read only by that member, to pre-fill their own next response.';

-- The counts a set of responses contributes — computed over the windows that
-- are about to go, and *added* to what the summary already holds. The
-- summary is a running total across retention runs: a member whose answers
-- cross the twelve-month line on different nights must not end up with only
-- the last of them.
create or replace function jobs.daypart_counts(p_response_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with parts as (
    select
      case when extract(isodow from (w.starts_at at time zone p.time_zone)::date) in (6, 7)
        then 'weekend' else 'weekday' end as prefix,
      extract(hour from (w.starts_at at time zone p.time_zone))::integer * 60
        + extract(minute from (w.starts_at at time zone p.time_zone))::integer as start_min,
      case
        when (w.ends_at at time zone p.time_zone)::date = (w.starts_at at time zone p.time_zone)::date
        then extract(hour from (w.ends_at at time zone p.time_zone))::integer * 60
          + extract(minute from (w.ends_at at time zone p.time_zone))::integer
        else extract(hour from (w.ends_at at time zone p.time_zone))::integer * 60
          + extract(minute from (w.ends_at at time zone p.time_zone))::integer + 1440
      end as end_min
    from public.willing_windows w
    join public.plan_responses r on r.id = w.response_id
    join public.plans p on p.id = r.plan_id
    where r.id = any (p_response_ids) and r.status = 'windows'
  ),
  bands (part, band_start, band_end) as (
    values ('morning', 0, 720), ('afternoon', 720, 1020), ('evening', 1020, 1440)
  ),
  covered as (
    select parts.prefix || '_' || bands.part as daypart
    from parts
    join bands on parts.start_min < bands.band_end and parts.end_min > bands.band_start
  ),
  all_parts (daypart, ordinal) as (
    values ('weekday_morning', 1), ('weekday_afternoon', 2), ('weekday_evening', 3),
           ('weekend_morning', 4), ('weekend_afternoon', 5), ('weekend_evening', 6)
  )
  select jsonb_object_agg(a.daypart, coalesce(c.n, 0) order by a.ordinal)
  from all_parts a
  left join (select daypart, count(*)::integer as n from covered group by daypart) c on c.daypart = a.daypart;
$$;

comment on function jobs.daypart_counts(uuid[]) is
  'How many of the given responses'' windows cover each of the six dayparts, by dayPartsCovered()''s rule.';

-- `summariseDayparts()`'s shape from a set of counts: the parts most offered
-- first, ties in the fixed order.
create or replace function jobs.daypart_summary(p_counts jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with all_parts (daypart, ordinal) as (
    values ('weekday_morning', 1), ('weekday_afternoon', 2), ('weekday_evening', 3),
           ('weekend_morning', 4), ('weekend_afternoon', 5), ('weekend_evening', 6)
  ),
  counted as (
    select a.daypart, a.ordinal, coalesce((p_counts ->> a.daypart)::integer, 0) as n
    from all_parts a
  )
  select jsonb_build_object(
    'parts', coalesce((select jsonb_agg(daypart order by n desc, ordinal) from counted where n > 0), '[]'::jsonb),
    'counts', (select jsonb_object_agg(daypart, n order by ordinal) from counted)
  );
$$;

comment on function jobs.daypart_summary(jsonb) is
  'The stored shape — {parts, counts} — from a set of counts, as summariseDayparts() orders them.';

create or replace function jobs.add_daypart_counts(p_a jsonb, p_b jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_object_agg(k, coalesce((p_a ->> k)::integer, 0) + coalesce((p_b ->> k)::integer, 0))
  from unnest(array[
    'weekday_morning', 'weekday_afternoon', 'weekday_evening',
    'weekend_morning', 'weekend_afternoon', 'weekend_evening'
  ]) as k;
$$;

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
  n_windows_aged integer;
  n_windows_gone integer;
  n_anonymous integer;
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
  delete from private.email_contacts c
  where c.status = 'pending'
    and c.created_at < now() - interval '7 days'
    and not exists (
      select 1 from private.email_action_tokens t
      where t.contact_id = c.id and t.used_at is null and t.expires_at > now()
    );
  get diagnostics n_pending_contacts = row_count;

  -- Verified plan-only contacts: 30 days after every plan they were subscribed
  -- to has finished. Every contact in the MVP is plan-only (spec §3: no
  -- marketing consent), so "plan-only" means "verified and not suppressed".
  -- A contact with a live subscription stays; one whose plans have all been
  -- completed, cancelled or expired for 30 days goes, address and all.
  delete from private.email_contacts c
  where c.status = 'verified'
    and not exists (
      select 1
      from private.email_subscriptions s
      join public.plans p on p.id = s.plan_id
      where s.contact_id = c.id
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
    'windows_aged', n_windows_aged,
    'windows_of_the_gone', n_windows_gone,
    'anonymous_identities', n_anonymous,
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

-- ---------------------------------------------------------------------------
-- The schedule.
--
-- The minute job calls the Edge Function through pg_net. The URL and the
-- bearer are database settings — `circles.functions_url`,
-- `circles.cron_secret` — set per environment after deploy and never written
-- in a migration. Until they are set the job is a no-op, so a fresh local
-- stack does not log a failed HTTP call every minute. The call is wrapped in
-- a function so the job's command text, which anyone who can read `cron.job`
-- can read, does not contain the header expression.
-- ---------------------------------------------------------------------------

create or replace function jobs.invoke_process_scheduled_jobs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := nullif(current_setting('circles.functions_url', true), '');
  secret text := nullif(current_setting('circles.cron_secret', true), '');
begin
  if base_url is null or secret is null then
    return null;
  end if;
  return net.http_post(
    url := base_url || '/process-scheduled-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

comment on function jobs.invoke_process_scheduled_jobs() is
  'Asks process-scheduled-jobs to run, via pg_net, with the bearer from circles.cron_secret. Null and no call when the settings are absent.';

select cron.schedule('process-jobs', '* * * * *', $$select jobs.invoke_process_scheduled_jobs()$$);
select cron.schedule('retention', '15 3 * * *', $$select jobs.run_retention()$$);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

alter table public.member_dayparts enable row level security;

-- Own summary only, and only while a member: it exists to pre-fill this
-- member's next answer in this circle and for nothing else (ADR 0005). No
-- client writes; retention writes it.
create policy member_dayparts_select_own on public.member_dayparts
  for select to authenticated
  using (user_id = (select auth.uid()) and public.auth_is_member(circle_id));

revoke all on public.member_dayparts from anon, authenticated;
grant select on public.member_dayparts to authenticated;

-- The lease is the dispatcher's; retention, the summary and the invoker are
-- the database's own.
revoke all on function jobs.acquire_lease(text, interval, text) from public;
revoke all on function jobs.acquire_lease(text, interval, text) from anon, authenticated;
grant execute on function jobs.acquire_lease(text, interval, text) to service_role;
revoke all on function jobs.release_lease(text, text) from public;
revoke all on function jobs.release_lease(text, text) from anon, authenticated;
grant execute on function jobs.release_lease(text, text) to service_role;
revoke all on function jobs.daypart_counts(uuid[]) from public;
revoke all on function jobs.daypart_counts(uuid[]) from anon, authenticated;
revoke all on function jobs.daypart_summary(jsonb) from public;
revoke all on function jobs.daypart_summary(jsonb) from anon, authenticated;
revoke all on function jobs.add_daypart_counts(jsonb, jsonb) from public;
revoke all on function jobs.add_daypart_counts(jsonb, jsonb) from anon, authenticated;
revoke all on function jobs.run_retention() from public;
revoke all on function jobs.run_retention() from anon, authenticated;
revoke all on function jobs.run_retention() from service_role;
revoke all on function jobs.invoke_process_scheduled_jobs() from public;
revoke all on function jobs.invoke_process_scheduled_jobs() from anon, authenticated;
revoke all on function jobs.invoke_process_scheduled_jobs() from service_role;
