-- Availability and scheduling: what people say, and what the engine says back.
--
-- Two kinds of row with opposite writers. Responses and willing windows are the
-- one thing a member writes about themselves; candidate sets and candidates are
-- written only by `recalculate-candidates` (S1-16) and read by everyone in the
-- circle. The constraints here are the product's privacy line made structural:
-- "Your friends will only see a combined result. They won't see your calendar
-- or a personal schedule view" (spec §5.5) — so nobody's windows are readable
-- by anybody else, and the combined result is the only thing that is.

-- ---------------------------------------------------------------------------
-- plan_responses
--
-- One per member per plan revision. The revision is part of the identity: an
-- edit that changes the question bumps it, and the old answers stop counting
-- rather than being reinterpreted (spec §5.3).
-- ---------------------------------------------------------------------------

create table public.plan_responses (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  revision integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Five explicit outcomes (spec §5.5). "None of these dates" is deliberately
  -- three-way rather than a bare decline: someone who wants to come but cannot
  -- this fortnight is telling you something different from someone who is out.
  status text not null,
  -- A flag only: no calendar data crosses the boundary (spec §5.5, §14).
  used_calendar_overlay boolean not null default false,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, revision, user_id),
  constraint plan_responses_status check (
    status in ('windows', 'flexible', 'none_work', 'more_notice', 'not_this_time')
  )
);

comment on table public.plan_responses is
  'A member''s answer to one revision of a plan. Written only through public.replace_response (ADR 0013). Readable in full by its owner; by others as a status through response_summaries.';

create index plan_responses_plan_revision_idx on public.plan_responses (plan_id, revision);
create index plan_responses_user_idx on public.plan_responses (user_id);

-- ---------------------------------------------------------------------------
-- willing_windows
--
-- "The only availability data that leaves a device" (spec §5.5). Half-hour
-- aligned, non-overlapping, inside the plan, and attached to a response that
-- says `windows` — the domain's `Response` union makes the last of those a
-- compile-time fact, and this trigger makes it a database one.
-- ---------------------------------------------------------------------------

create table public.willing_windows (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.plan_responses (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint willing_windows_order check (ends_at > starts_at),
  -- No two windows of one response overlap. An exclusion constraint rather
  -- than a trigger, because "no overlap" is a shape the index can hold by
  -- itself, and it holds under concurrent inserts where a trigger would not.
  constraint willing_windows_no_overlap
    exclude using gist (response_id with =, tstzrange(starts_at, ends_at) with &&)
);

comment on table public.willing_windows is
  'Half-hour spans a member said they would be up for. Readable only by that member; the engine reads them as the service role.';

create index willing_windows_response_idx on public.willing_windows (response_id);

-- Alignment is judged in the **plan's zone**, not UTC. The ticket's sketch had
-- `extract(minute from starts_at at time zone 'UTC') in (0, 30)`, and that is
-- wrong for every zone that is not a whole hour off UTC: Kathmandu is +05:45,
-- so a window painted 09:00–10:00 there is 03:15–04:15 UTC and would have been
-- refused, while 09:15 local would have passed. S1-03 hit exactly this in the
-- domain, and the database has to agree with it.
create or replace function public.enforce_window_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  response public.plan_responses;
  plan public.plans;
  local_start timestamp;
  local_end timestamp;
  band_start timestamp;
  band_end timestamp;
begin
  select * into response from public.plan_responses r where r.id = new.response_id;
  select * into plan from public.plans p where p.id = response.plan_id;

  -- Windows belong to a `windows` answer and nothing else: a `not_this_time`
  -- with a window attached would be availability the person had withdrawn.
  if response.status <> 'windows' then
    raise exception 'a % response carries no windows', response.status
      using errcode = 'check_violation';
  end if;

  local_start := new.starts_at at time zone plan.time_zone;
  local_end := new.ends_at at time zone plan.time_zone;

  if extract(minute from local_start)::integer % 30 <> 0
     or extract(second from local_start) <> 0
     or extract(minute from local_end)::integer % 30 <> 0
     or extract(second from local_end) <> 0 then
    raise exception 'window %–% is not on a half hour in %', new.starts_at, new.ends_at, plan.time_zone
      using errcode = 'check_violation';
  end if;

  -- Inside the plan: on a day of the window, within the daily band. Judged on
  -- the local clock so the day the clocks change reads the way the person saw
  -- it. The band end may be 1440, which is midnight and rolls to the next day.
  band_start := (plan.window_start::timestamp + make_interval(mins => plan.daily_start_local));
  band_end := (plan.window_end::timestamp + make_interval(mins => plan.daily_end_local));
  if local_start < band_start or local_end > band_end
     or (extract(hour from local_start) * 60 + extract(minute from local_start)) < plan.daily_start_local
     or (
       local_end::date = local_start::date
       and (extract(hour from local_end) * 60 + extract(minute from local_end)) > plan.daily_end_local
     ) then
    raise exception 'window %–% lies outside the plan''s window', new.starts_at, new.ends_at
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_window_shape() is
  'Half-hour aligned in the plan''s zone, inside the plan''s window and band, and attached to a `windows` response. Mirrors normaliseWindows() in packages/domain/src/availability/windows.ts.';

create trigger willing_windows_shape
  before insert or update on public.willing_windows
  for each row execute function public.enforce_window_shape();

-- ---------------------------------------------------------------------------
-- input_version
--
-- Bumped whenever an *answer* to the current revision changes, on either table
-- (architecture §9.1). A trigger rather than a line in `replace_response`, so
-- the invariant holds for every write path there will ever be — the
-- recalculation function persists only if this is still current, and `confirm`
-- refuses a set computed against an older one, so a bump missed anywhere is a
-- stale set treated as fresh.
-- ---------------------------------------------------------------------------

create or replace function public.bump_input_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.plan_responses;
  window_response uuid;
begin
  -- Branch on the table before touching a field: `new.response_id` on a
  -- `plan_responses` row is an error, not a null, and plpgsql evaluates a
  -- `coalesce` of record fields eagerly.
  if tg_table_name = 'plan_responses' then
    if tg_op = 'DELETE' then target := old; else target := new; end if;
  else
    if tg_op = 'DELETE' then window_response := old.response_id;
    else window_response := new.response_id; end if;
    select * into target from public.plan_responses r where r.id = window_response;
    -- Gone already when a response's delete cascades to its windows; that
    -- response's own trigger has bumped, and there is nothing here to bump for.
    if not found then return null; end if;
  end if;

  -- Only the current revision. An old revision's rows do not change under the
  -- RPC, but a retention job might touch them, and that is not a new answer.
  update public.plans p
  set input_version = p.input_version + 1
  where p.id = target.plan_id and p.revision = target.revision;

  return null;
end;
$$;

create trigger plan_responses_bump_input_version
  after insert or update or delete on public.plan_responses
  for each row execute function public.bump_input_version();
create trigger willing_windows_bump_input_version
  after insert or update or delete on public.willing_windows
  for each row execute function public.bump_input_version();

create trigger plan_responses_touch_updated_at
  before update on public.plan_responses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- candidate_sets and candidates
--
-- The engine's output, persisted exactly as `generateCandidates` returns it
-- (packages/domain/src/scheduling/types.ts). Keyed on `(plan_id, revision,
-- input_version)`: the set for one question, at one state of the answers.
-- ---------------------------------------------------------------------------

create table public.candidate_sets (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  revision integer not null,
  input_version integer not null,
  scoring_version integer not null,
  -- The engine's own digest of its input, for change detection rather than
  -- security — see inputHash() in packages/domain/src/scheduling/hash.ts.
  input_hash text not null,
  generated_at timestamptz not null default now(),
  starts_considered integer not null,
  eligible_count integer not null,
  responded_count integer not null,
  active_member_count integer not null,
  unique (plan_id, revision, input_version),
  constraint candidate_sets_counts check (
    starts_considered >= 0 and eligible_count >= 0
    and responded_count >= 0 and active_member_count >= 0
  )
);

comment on table public.candidate_sets is
  'One run of the candidate engine for one plan revision at one input_version. Written only by recalculate-candidates.';

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_set_id uuid not null references public.candidate_sets (id) on delete cascade,
  -- Eligible options and near-misses share a shape and a table, distinguished
  -- rather than split: the screen renders both as cards, and the engine ranks
  -- both. Each kind has its own rank sequence.
  is_near_miss boolean not null,
  rank integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- In members-list order, never a non-responder (spec §5.6).
  available_user_ids uuid[] not null,
  explicit_count integer not null,
  flexible_count integer not null,
  explanation_code text not null,
  -- The available count the explanation names — "Also **four**, a day later".
  explanation_count integer not null,
  -- `{"kind":"quorum_short","by":n}` or `{"kind":"required_missing","userId":…}`.
  -- One rule, not a list (spec §5.6); only ever on a near-miss.
  near_miss_reason jsonb,
  -- At most three of each kind (architecture §12 steps 5 and 7).
  constraint candidates_rank check (rank between 1 and 3),
  unique (candidate_set_id, is_near_miss, rank),
  -- A candidate's identity is its start instant (SUS-21): the id the organiser
  -- holds on the review screen still points at the same time after a
  -- recalculation, which a row id would not. So one start per set.
  unique (candidate_set_id, starts_at),
  constraint candidates_order check (ends_at > starts_at),
  constraint candidates_counts check (
    explicit_count >= 0 and flexible_count >= 0
    and explicit_count + flexible_count = cardinality(available_user_ids)
  ),
  -- An eligible option has somebody; a near-miss may have nobody (ADR 0011:
  -- when every member said none of these work, zero is as close as it got).
  constraint candidates_eligible_have_someone check (
    is_near_miss or cardinality(available_user_ids) >= 1
  ),
  constraint candidates_reason_iff_near_miss check (
    (is_near_miss and near_miss_reason is not null)
    or (not is_near_miss and near_miss_reason is null)
  ),
  constraint candidates_reason_shape check (
    near_miss_reason is null
    or (near_miss_reason ->> 'kind' = 'quorum_short' and (near_miss_reason ->> 'by')::integer >= 1)
    or (near_miss_reason ->> 'kind' = 'required_missing' and (near_miss_reason ->> 'userId') is not null)
  ),
  constraint candidates_explanation_code check (
    explanation_code in (
      'best_attendance', 'same_attendance_weekend', 'same_attendance_sooner',
      'same_attendance_later', 'one_fewer_weekend', 'one_fewer_sooner', 'one_fewer_later',
      'also_n_sooner', 'also_n_later', 'closest'
    )
  )
);

comment on table public.candidates is
  'The engine''s options and near-misses for one candidate set. Identity is (candidate_set_id, starts_at); the client''s candidate id is the ISO start.';

create index candidates_set_rank_idx on public.candidates (candidate_set_id, is_near_miss, rank);

-- ---------------------------------------------------------------------------
-- response_summaries
--
-- Who has answered, and how — never what they said. `user_id, status,
-- submitted_at` is the whole of what one member may learn about another's
-- answer (spec §5.5: "a combined result … not a personal schedule view"), and
-- it is enough for "5 of 6 replied", the dashed marks and the re-ask warning.
--
-- Definer by design, like `member_profiles`: the point is a column limit on a
-- table the caller may otherwise read only their own row of, which RLS cannot
-- express.
-- ---------------------------------------------------------------------------

create view public.response_summaries as
select r.plan_id, r.revision, r.user_id, r.status, r.submitted_at
from public.plan_responses r
join public.plans p on p.id = r.plan_id
where public.auth_is_member(p.circle_id);

comment on view public.response_summaries is
  'Who has answered a plan revision and with which status. Never a window: those are readable only by their owner.';

revoke all on public.response_summaries from anon, authenticated;
grant select on public.response_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- replace_response
--
-- The one way a member's answer is written (ADR 0013). Replaces the response
-- and all its windows in one transaction under the plan's row lock, so a reader
-- never sees a response with half its windows, and the input_version bump and
-- the outbox event happen exactly once per answer rather than once per window.
-- ---------------------------------------------------------------------------

-- Parameters carry a `p_` prefix, as `transition_plan`'s do: a parameter named
-- `plan_id` is ambiguous against the column of the same name inside
-- `on conflict (plan_id, …)`, and plpgsql refuses to guess.
create or replace function public.replace_response(
  p_plan_id uuid,
  p_status text,
  p_windows jsonb default '[]'::jsonb,
  p_used_calendar_overlay boolean default false
)
returns public.plan_responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  response public.plan_responses;
  w jsonb;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- The lock: two submissions from one person's two devices would otherwise
  -- interleave their window deletes and inserts.
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not public.auth_is_member(plan.circle_id) then
    -- The same answer for "no such plan" and "not your circle": telling them
    -- apart would confirm a plan id exists.
    raise exception 'plan not found' using errcode = 'insufficient_privilege';
  end if;

  -- Addressed to this person: spec §9 makes joining an active plan an opt-in,
  -- and answering a question you were not asked is how a newcomer becomes a
  -- non-responder to it.
  if not exists (
    select 1 from public.plan_participants pp
    where pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = caller
  ) then
    raise exception 'not a participant in this plan' using errcode = 'insufficient_privilege';
  end if;

  -- "Editing is allowed until confirmation or the deadline" (spec §5.5).
  if plan.state not in ('collecting', 'ready') then
    raise exception 'replies are closed: plan is %', plan.state using errcode = 'check_violation';
  end if;
  if now() >= plan.response_deadline then
    raise exception 'replies closed at %', plan.response_deadline using errcode = 'check_violation';
  end if;

  -- The domain's union, enforced: only a `windows` answer carries windows, and
  -- a `windows` answer carries at least one.
  if p_status = 'windows' and jsonb_array_length(p_windows) = 0 then
    raise exception 'a windows response needs at least one window' using errcode = 'check_violation';
  end if;
  if p_status <> 'windows' and jsonb_array_length(p_windows) > 0 then
    raise exception 'a % response carries no windows', p_status
      using errcode = 'check_violation';
  end if;

  -- Replace, not merge. The person's answer is the whole list they sent.
  delete from public.willing_windows ww
  using public.plan_responses r
  where ww.response_id = r.id
    and r.plan_id = plan.id and r.revision = plan.revision and r.user_id = caller;

  insert into public.plan_responses (plan_id, revision, user_id, status, used_calendar_overlay, submitted_at)
  values (plan.id, plan.revision, caller, p_status, p_used_calendar_overlay, now())
  on conflict (plan_id, revision, user_id) do update
    set status = excluded.status,
        used_calendar_overlay = excluded.used_calendar_overlay,
        submitted_at = excluded.submitted_at
  returning * into response;

  for w in select * from jsonb_array_elements(p_windows) loop
    insert into public.willing_windows (response_id, starts_at, ends_at)
    values (response.id, (w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz);
  end loop;

  -- TODO(S1-11): write `availability.response_submitted` to `jobs.outbox` here.
  -- `020_outbox_dependency.sql` fails the build the day the table appears.

  return response;
end;
$$;

comment on function public.replace_response(uuid, text, jsonb, boolean) is
  'Replaces the caller''s answer to the plan''s current revision atomically. The only write path for responses and windows (ADR 0013).';

revoke all on function public.replace_response(uuid, text, jsonb, boolean) from public;
revoke all on function public.replace_response(uuid, text, jsonb, boolean) from anon, authenticated;
grant execute on function public.replace_response(uuid, text, jsonb, boolean) to authenticated;

revoke all on function public.enforce_window_shape() from public;
revoke all on function public.enforce_window_shape() from anon, authenticated;
revoke all on function public.bump_input_version() from public;
revoke all on function public.bump_input_version() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The candidate guard, now that there are candidates to check against.
--
-- `planning.transition_plan` shipped in 0003 checking only that a candidate id
-- was *supplied*, because this table did not exist; `040_candidate_guard_dependency.sql`
-- was the tripwire, and this is what it tripped for. The function is
-- redefined whole rather than patched, because a migration is append-only and
-- a reader of 0003 should still see what 0003 did.
--
-- The check is the domain's: the id names an eligible candidate in the set for
-- the plan's *current* revision, input version and scoring version — a
-- candidate can stop being eligible between the organiser opening the review
-- screen and tapping the button, and a set computed before somebody withdrew
-- a reply names people who are no longer free.
-- ---------------------------------------------------------------------------

create or replace function planning.candidate_is_eligible(plan public.plans, candidate_id text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  start_at timestamptz;
begin
  -- The client's candidate id is the ISO start (candidateIdOf). Anything that
  -- is not an instant is not a candidate, rather than an error.
  begin
    start_at := candidate_id::timestamptz;
  exception when others then
    return false;
  end;

  return exists (
    select 1
    from public.candidate_sets cs
    join public.candidates c on c.candidate_set_id = cs.id
    where cs.plan_id = plan.id
      and cs.revision = plan.revision
      and cs.input_version = plan.input_version
      and cs.scoring_version = plan.scoring_version
      and not c.is_near_miss
      and c.starts_at = start_at
  );
end;
$$;

revoke all on function planning.candidate_is_eligible(public.plans, text) from public;
revoke all on function planning.candidate_is_eligible(public.plans, text) from anon, authenticated;

create or replace function planning.transition_plan(
  p_plan_id uuid,
  p_action text,
  p_actor uuid,
  p_payload jsonb default '{}'::jsonb
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  rule planning.transitions;
  member public.circle_members;
  is_permanent boolean;
  guard text;
  next_revision integer;
begin
  select * into plan from public.plans where id = p_plan_id for update;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into rule
  from planning.transitions t
  where t.from_state = plan.state and t.action = p_action;

  if not found then
    if plan.state in ('completed', 'expired', 'cancelled') then
      raise exception 'plan_is_finished' using errcode = 'P0001';
    end if;
    raise exception 'wrong_state' using errcode = 'P0001';
  end if;

  select * into member
  from public.circle_members m
  where m.circle_id = plan.circle_id and m.user_id = p_actor and m.status = 'active';

  select p.is_permanent into is_permanent
  from public.profiles p where p.user_id = p_actor;

  -- Shape before semantics, and this is a reorder from 0003: a caller who sent
  -- a key the action does not take should learn that first, rather than only
  -- after producing a candidate the guard accepts.
  if exists (
    select 1 from jsonb_object_keys(p_payload) k
    where k <> all (planning.allowed_keys(p_action))
  ) then
    raise exception 'unexpected_payload' using errcode = 'P0001';
  end if;

  foreach guard in array rule.guards loop
    case guard
      when 'member' then
        if member.user_id is null then
          raise exception 'not_a_member' using errcode = 'P0001';
        end if;
      when 'organiser' then
        if plan.organiser_user_id is distinct from p_actor or member.user_id is null then
          raise exception 'not_the_organiser' using errcode = 'P0001';
        end if;
      when 'permanent' then
        if not coalesce(is_permanent, false) then
          raise exception 'needs_permanent_identity' using errcode = 'P0001';
        end if;
      when 'no_organiser_yet' then
        if plan.organiser_user_id is not null then
          raise exception 'already_has_organiser' using errcode = 'P0001';
        end if;
      when 'initiator' then
        if not exists (
          select 1 from private.plan_initiators pi
          where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
        ) then
          raise exception 'not_the_initiator' using errcode = 'P0001';
        end if;
      when 'keen_initiator_or_owner' then
        if not exists (
          select 1 from private.plan_interest i
          where i.plan_id = plan.id and i.user_id = p_actor and i.response = 'keen'
        ) and not exists (
          select 1 from private.plan_initiators pi
          where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
        ) and not exists (
          select 1 from public.circles c
          where c.id = plan.circle_id and c.owner_user_id = p_actor
        ) then
          raise exception 'not_keen_initiator_or_owner' using errcode = 'P0001';
        end if;
      when 'threshold' then
        if plan.quiet_threshold is null or (
          select count(*) from private.plan_interest i
          where i.plan_id = plan.id and i.response = 'keen'
        ) < plan.quiet_threshold then
          raise exception 'threshold_not_reached' using errcode = 'P0001';
        end if;
      when 'candidate' then
        -- Eligibility, not presence. This is the line 0003 could not write.
        if not planning.candidate_is_eligible(plan, p_payload ->> 'candidate_id') then
          raise exception 'needs_candidate' using errcode = 'P0001';
        end if;
      else
        raise exception 'UNKNOWN_GUARD_%', guard using errcode = 'P0001';
    end case;
  end loop;

  next_revision := plan.revision + (case when rule.bumps_revision then 1 else 0 end);

  perform set_config('circles.in_transition', 'on', true);

  update public.plans p set
    state = rule.to_state,
    revision = next_revision,
    input_version = case when rule.bumps_revision then 1 else p.input_version end,
    organiser_user_id = case
      when p_action = 'accept_organiser' then p_actor
      else p.organiser_user_id
    end,
    window_start = coalesce((p_payload ->> 'window_start')::date, p.window_start),
    window_end = coalesce((p_payload ->> 'window_end')::date, p.window_end),
    daily_start_local = coalesce((p_payload ->> 'daily_start_local')::integer, p.daily_start_local),
    daily_end_local = coalesce((p_payload ->> 'daily_end_local')::integer, p.daily_end_local),
    duration_minutes = coalesce((p_payload ->> 'duration_minutes')::integer, p.duration_minutes),
    quorum = coalesce((p_payload ->> 'quorum')::integer, p.quorum),
    response_deadline = coalesce((p_payload ->> 'response_deadline')::timestamptz, p.response_deadline),
    cancel_note = case
      when rule.to_state = 'cancelled' then p_payload ->> 'cancel_note'
      else p.cancel_note
    end
  where p.id = p_plan_id
  returning * into plan;

  perform set_config('circles.in_transition', 'off', true);

  -- TODO(S1-11): write the planning.* outbox event here, in this transaction.

  return plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- A member reads their own answer in full and everyone's status through the
-- summary view. Candidate sets are the combined result and readable by the
-- whole circle. Nobody writes any of these tables from a client.
-- ---------------------------------------------------------------------------

alter table public.plan_responses enable row level security;
alter table public.willing_windows enable row level security;
alter table public.candidate_sets enable row level security;
alter table public.candidates enable row level security;

create policy plan_responses_select_own on public.plan_responses
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Own windows only, through own response. There is no policy under which one
-- member reads another's windows, and there must never be: it is the privacy
-- line on the availability screen, structurally.
create policy willing_windows_select_own on public.willing_windows
  for select to authenticated
  using (exists (
    select 1 from public.plan_responses r
    where r.id = response_id and r.user_id = (select auth.uid())
  ));

create policy candidate_sets_select_member on public.candidate_sets
  for select to authenticated
  using (exists (
    select 1 from public.plans p where p.id = plan_id and public.auth_is_member(p.circle_id)
  ));

create policy candidates_select_member on public.candidates
  for select to authenticated
  using (exists (
    select 1
    from public.candidate_sets cs
    join public.plans p on p.id = cs.plan_id
    where cs.id = candidate_set_id and public.auth_is_member(p.circle_id)
  ));

revoke all on public.plan_responses from anon, authenticated;
revoke all on public.willing_windows from anon, authenticated;
revoke all on public.candidate_sets from anon, authenticated;
revoke all on public.candidates from anon, authenticated;

grant select on public.plan_responses to authenticated;
grant select on public.willing_windows to authenticated;
grant select on public.candidate_sets to authenticated;
grant select on public.candidates to authenticated;

-- The service role writes candidate sets (recalculate-candidates) and never
-- responses: those come from a member, through replace_response, and a set
-- written by a function that did not go through the trigger would not bump
-- input_version.
revoke all on public.plan_responses from service_role;
revoke all on public.willing_windows from service_role;
grant select on public.plan_responses to service_role;
grant select on public.willing_windows to service_role;
