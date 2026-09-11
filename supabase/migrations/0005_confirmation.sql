-- Confirmation and outcomes: the moment a plan becomes real, and what became
-- of it.
--
-- Two invariants carry the north-star metric, and architecture §6.2 names
-- them: **one active confirmation per plan revision**, and **`happened` is the
-- only outcome that moves `last_met_at`**. Everything else here exists so that
-- those two are properties of the database rather than promises about callers.
--
-- The domain module (`packages/domain/src/confirmation`) is the source of every
-- rule below. Where a trigger enforces a transition, its comment names the
-- domain function it mirrors, so a change to one is a change somebody has to
-- make to the other.

-- ---------------------------------------------------------------------------
-- meetup_confirmations
--
-- A frozen copy, not a reference. `candidate_id` is the ISO start the client
-- held; `starts_at`, `ends_at` and `available_user_ids` are copied from the
-- candidate at the moment of confirming, because "Times are frozen once
-- locked. Later replies won't move it" is on the ConfirmReview screen and a
-- foreign key to `candidates` would let a recalculation make it false.
-- ---------------------------------------------------------------------------

create table public.meetup_confirmations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  revision integer not null,
  -- The domain's `CandidateId`: the ISO start. Kept so the row can say which
  -- option was chosen even after the set it came from is gone.
  candidate_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Who could make it **when it was locked in**. In members-list order, never
  -- a non-responder (spec §5.6). Later replies do not change it.
  available_user_ids uuid[] not null,
  place_name text,
  -- An address or map link. `http(s)` only, as `isLink` in the domain has it.
  place_url text,
  note text,
  -- "Did you have to chase anyone outside the app?" — asked on the confirmation
  -- review (spec §5.10), so it lives here, with the confirmation it was asked
  -- about, and not with the outcome that is reported days later. Evidence for
  -- H2. `none` / `one` / `more`.
  chased_answer text,
  confirmed_by uuid not null references auth.users (id),
  -- `superseded` is a reschedule; `cancelled` a decision to stop; `completed`
  -- an outcome having been reported. All three keep the row and its time:
  -- "Thursday is off the table" has to stay true in the record after Thursday
  -- stops being the plan.
  status text not null default 'active',
  confirmed_at timestamptz not null default now(),
  superseded_at timestamptz,
  -- Why it stopped being active — the domain's `SupersedeReason`, or
  -- `outcome` once an outcome closed it.
  superseded_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetup_confirmations_status check (
    status in ('active', 'superseded', 'cancelled', 'completed')
  ),
  constraint meetup_confirmations_order check (ends_at > starts_at),
  constraint meetup_confirmations_note_length check (
    note is null or char_length(note) <= 280
  ),
  constraint meetup_confirmations_place_name_length check (
    place_name is null or char_length(place_name) <= 120
  ),
  constraint meetup_confirmations_chased check (
    chased_answer is null or chased_answer in ('none', 'one', 'more')
  ),
  constraint meetup_confirmations_place_url_is_link check (
    place_url is null or place_url ~ '^https?://[^[:space:]]+$'
  ),
  -- A `case`, because `(status = 'active' and x is null) or (...)` is null for
  -- a null `x` and a null CHECK passes — the trap 0003 and 0004 both hit.
  constraint meetup_confirmations_superseded_shape check (
    case status
      when 'active' then superseded_at is null and superseded_reason is null
      else superseded_at is not null and superseded_reason in ('reopen', 'cancel', 'outcome')
    end
  )
);

comment on table public.meetup_confirmations is
  'A frozen copy of the chosen candidate. One active per (plan_id, revision); superseded rather than mutated on reschedule (architecture §6.2). Written only by confirm-meetup.';

-- The invariant, as an index: at most one `active` row per revision, and it
-- holds under concurrent inserts where a trigger would not.
create unique index meetup_confirmations_one_active_idx
  on public.meetup_confirmations (plan_id, revision)
  where status = 'active';

create index meetup_confirmations_plan_idx on public.meetup_confirmations (plan_id);

-- ---------------------------------------------------------------------------
-- attendance
--
-- Five statuses, two questions (domain `types.ts`): `going` / `cant` /
-- `unknown` before the meetup, `was_there` / `missed` after it. The rows are
-- derived at confirmation by `deriveAttendance` and corrected by each member
-- for themselves — the one table in this migration a member writes directly.
-- ---------------------------------------------------------------------------

create table public.attendance (
  confirmation_id uuid not null references public.meetup_confirmations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  updated_at timestamptz not null default now(),
  primary key (confirmation_id, user_id),
  constraint attendance_status check (
    status in ('going', 'cant', 'unknown', 'was_there', 'missed')
  )
);

comment on table public.attendance is
  'Who is coming, and afterwards who came. Each member writes their own row; the transitions are enforced by attendance_transition, which mirrors updateAttendance() in the domain.';

create index attendance_user_idx on public.attendance (user_id);

-- ---------------------------------------------------------------------------
-- outcome_reports
--
-- "Did this catch-up happen?" (spec §5.10), plus the second tap of the H2
-- micro-survey: whether the plan changed outside the app. Written only through
-- `report_outcome` below — the trigger on insert is the invariant, the
-- function is the door.
-- ---------------------------------------------------------------------------

create table public.outcome_reports (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references public.meetup_confirmations (id) on delete cascade,
  reported_by uuid not null references auth.users (id),
  outcome text not null,
  note text,
  -- "Did the plan change outside the app?" — the outcome half of the H2
  -- micro-survey; the chasing half is on the confirmation.
  moved_outside boolean,
  reported_at timestamptz not null default now(),
  unique (confirmation_id, reported_by),
  constraint outcome_reports_outcome check (
    outcome in ('happened', 'cancelled', 'moved_outside', 'not_sure')
  ),
  constraint outcome_reports_note_length check (note is null or char_length(note) <= 280)
);

comment on table public.outcome_reports is
  'The organiser''s answer to "did it happen?", with the micro-survey. Only `happened` moves the circle''s last_met_at, and never backwards.';

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create trigger meetup_confirmations_touch_updated_at
  before update on public.meetup_confirmations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Supersede on reschedule; cancel on cancel.
--
-- A trigger on `plans`, so that leaving `confirmed` by any transition takes
-- the active confirmation with it in the same statement. `transition_plan`
-- need not know confirmations exist, and there is no window in which a plan is
-- back in `collecting` with a confirmation still `active`.
-- ---------------------------------------------------------------------------

create or replace function public.supersede_on_leaving_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state <> 'confirmed' or new.state = 'confirmed' then
    return new;
  end if;

  -- `reopen` bumps the revision and goes to collecting; `cancel` goes to
  -- cancelled. `report_outcome` goes to completed, and `apply_outcome` has
  -- normally closed the confirmation already with the outcome's own status —
  -- but a `report_outcome` applied directly, without a report, must not leave a
  -- completed plan with an active confirmation, so this closes it too.
  update public.meetup_confirmations c
  set status = case new.state when 'cancelled' then 'cancelled' when 'completed' then 'completed' else 'superseded' end,
      superseded_at = now(),
      superseded_reason = case new.state when 'cancelled' then 'cancel' when 'completed' then 'outcome' else 'reopen' end
  where c.plan_id = new.id
    and c.revision = old.revision
    and c.status = 'active';

  return new;
end;
$$;

comment on function public.supersede_on_leaving_confirmed() is
  'Reschedule supersedes, cancel cancels, never mutates (architecture §6.2). Mirrors supersede() in the domain.';

create trigger plans_supersede_confirmation
  after update of state on public.plans
  for each row execute function public.supersede_on_leaving_confirmed();

-- ---------------------------------------------------------------------------
-- Attendance transitions.
--
-- Mirrors `updateAttendance` / `applyAttendance` in the domain, rule for rule:
--
--   * before the meetup, `going` and `cant` swap freely; after it, `was_there`
--     and `missed` swap freely; nothing goes back from an answer about the
--     past to a promise about the future;
--   * a retrospective status is refused before the meetup has ended — "I was
--     there" before Thursday is not an early answer, it is a false one, and
--     `corroboration` would go on to count it;
--   * the same status twice is a no-op, not a fresh answer: the confirmed
--     screen orders by `updated_at`, and a duplicate tap must not announce a
--     change of mind nobody made;
--   * only a participant of the confirmation's revision has a row, and only on
--     a confirmation that is active or completed.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_attendance_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  confirmation public.meetup_confirmations;
  allowed text[];
begin
  select * into confirmation from public.meetup_confirmations c where c.id = new.confirmation_id;

  if confirmation.id is null then
    raise exception 'attendance_confirmation_missing' using errcode = 'foreign_key_violation';
  end if;
  if confirmation.status not in ('active', 'completed') then
    raise exception 'attendance_confirmation_not_live' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.plan_participants pp
    where pp.plan_id = confirmation.plan_id
      and pp.revision = confirmation.revision
      and pp.user_id = new.user_id
  ) then
    raise exception 'attendance_not_a_participant' using errcode = 'check_violation';
  end if;

  if new.status in ('was_there', 'missed') and now() < confirmation.ends_at then
    raise exception 'attendance_too_early' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.status = old.status then
      -- Idempotent: return the old row untouched, `updated_at` included.
      return old;
    end if;

    allowed := case old.status
      when 'unknown' then array['going', 'cant', 'was_there', 'missed']
      when 'going' then array['cant', 'was_there', 'missed']
      when 'cant' then array['going', 'was_there', 'missed']
      when 'was_there' then array['missed']
      when 'missed' then array['was_there']
    end;
    if not (new.status = any (allowed)) then
      raise exception 'attendance_not_reversible' using errcode = 'check_violation';
    end if;

    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.enforce_attendance_transition() is
  'The attendance state machine, as updateAttendance() has it: no promise about the future after an answer about the past, no answer about the past before the meetup has ended, and a repeat is a no-op.';

create trigger attendance_transition
  before insert or update on public.attendance
  for each row execute function public.enforce_attendance_transition();

-- ---------------------------------------------------------------------------
-- Outcomes.
--
-- Mirrors `reportOutcome` and `lastMetAtAfter`. One insert does four things,
-- in one transaction, so none can happen without the others: the plan moves
-- to `completed` through `transition_plan` (which is where "is this the
-- organiser, and still a member" is decided — not re-derived here), the
-- confirmation closes, and the circle's `last_met_at` moves if — and only if —
-- the answer was `happened`, and only forwards.
-- ---------------------------------------------------------------------------

create or replace function public.apply_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmation public.meetup_confirmations;
  plan public.plans;
begin
  -- Lock order is plan, then confirmation — the same order `cancel` and
  -- `reopen` take (`transition_plan` locks the plan; its trigger then writes
  -- the confirmation). Locking the confirmation first here would let an
  -- outcome racing a cancel deadlock instead of one of them simply losing.
  -- The confirmation is read again after the lock, because the loser has to
  -- see what the winner did.
  select p.* into plan
  from public.plans p
  join public.meetup_confirmations c on c.plan_id = p.id
  where c.id = new.confirmation_id
  for update of p;
  select * into confirmation from public.meetup_confirmations c where c.id = new.confirmation_id;

  -- Reporting on a superseded confirmation would attach an outcome to a time
  -- that was replaced — and, through the `last_met_at` move below, could set
  -- the circle's record to an evening it explicitly abandoned.
  if confirmation.status <> 'active' then
    raise exception 'confirmation_not_active' using errcode = 'check_violation';
  end if;
  if confirmation.revision <> plan.revision then
    raise exception 'stale_confirmation' using errcode = 'check_violation';
  end if;

  -- "The morning after a confirmed meetup" (spec §5.10). Asked any earlier the
  -- question has no answer yet, and `happened` would set `last_met_at` to an
  -- instant that has not arrived — which cadence then reads.
  if now() < confirmation.ends_at then
    raise exception 'outcome_too_early' using errcode = 'check_violation';
  end if;

  -- `statusAfter`: `cancelled` is the one outcome that says the meetup did not
  -- take place at all; the other three describe a finished attempt. Closed
  -- before the transition, so the plans trigger finds nothing left to close.
  update public.meetup_confirmations c
  set status = case when new.outcome = 'cancelled' then 'cancelled' else 'completed' end,
      superseded_at = now(),
      superseded_reason = 'outcome'
  where c.id = confirmation.id;

  -- The organiser guard lives in the state machine and is not duplicated here.
  -- A non-organiser, or an organiser who has left the circle, is refused by
  -- `transition_plan` with the same code the client's `canTransition` uses —
  -- and the refusal rolls the close above back with it.
  perform planning.transition_plan(plan.id, 'report_outcome', new.reported_by);

  -- Only `happened`, to the time the circle actually met rather than to now —
  -- and never backwards. An outcome can be reported late, and a circle that has
  -- met again since must not be told it last met a fortnight ago because
  -- somebody finally answered an old email. Cadence is built on this field.
  if new.outcome = 'happened' then
    update public.circles c
    set last_met_at = greatest(coalesce(c.last_met_at, confirmation.starts_at), confirmation.starts_at)
    where c.id = plan.circle_id;
  end if;

  return new;
end;
$$;

comment on function public.apply_outcome() is
  'Mirrors reportOutcome() and lastMetAtAfter(): completes the plan through transition_plan, closes the confirmation, and moves last_met_at only for `happened`, only forwards.';

create trigger outcome_reports_apply
  after insert on public.outcome_reports
  for each row execute function public.apply_outcome();

-- The one way a client reports an outcome (architecture §8.4: attendance is
-- the only confirmation table a member writes directly). The actor is
-- `auth.uid()`, never a parameter, and `reported_at` is the server's clock.
-- The organiser check here is the cheap, early one; the one that counts —
-- organiser *and still a member* — is `transition_plan`'s, reached through the
-- trigger, and it is not duplicated.
create or replace function public.report_outcome(
  p_confirmation_id uuid,
  p_outcome text,
  p_note text default null,
  p_moved_outside boolean default null
)
returns public.outcome_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  organiser uuid;
  report public.outcome_reports;
begin
  if actor is null then
    raise exception 'report_outcome requires a signed-in actor' using errcode = 'insufficient_privilege';
  end if;

  select p.organiser_user_id into organiser
  from public.meetup_confirmations c
  join public.plans p on p.id = c.plan_id
  where c.id = p_confirmation_id;

  if organiser is distinct from actor then
    raise exception 'only the organiser reports an outcome' using errcode = 'insufficient_privilege';
  end if;

  insert into public.outcome_reports (confirmation_id, reported_by, outcome, note, moved_outside)
  values (p_confirmation_id, actor, p_outcome, p_note, p_moved_outside)
  returning * into report;

  return report;
end;
$$;

comment on function public.report_outcome(uuid, text, text, boolean) is
  'The organiser''s answer to "did this catch-up happen?". The only client write path to outcome_reports; the insert trigger does the rest.';

-- ---------------------------------------------------------------------------
-- Removal, continued.
--
-- 0004's trigger deletes availability and drops participation. Spec §4.5 also
-- says "historic aggregate attendance may remain", so attendance rows are
-- kept — but on a *live* confirmation a removed member is not coming, and a
-- `going` from them would keep them in "5 going" and on the reminder list.
-- Redefined whole rather than adding a second trigger, so the consequences of
-- removal stay in one place and cannot be applied separately.
-- ---------------------------------------------------------------------------

create or replace function public.on_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected uuid;
begin
  if new.status <> 'removed' or old.status = 'removed' then
    return new;
  end if;

  perform 1 from public.plans p where p.circle_id = new.circle_id for update;

  delete from public.plan_responses r
  using public.plans p
  where r.plan_id = p.id
    and p.circle_id = new.circle_id and r.user_id = new.user_id;

  update public.plans p
  set input_version = p.input_version + 1
  where p.circle_id = new.circle_id
    and p.state in ('seeking', 'collecting', 'ready');

  delete from public.plan_participants pp
  using public.plans p
  where pp.plan_id = p.id and pp.revision = p.revision and pp.user_id = new.user_id
    and p.circle_id = new.circle_id
    and p.state in ('seeking', 'collecting', 'ready');

  for affected in
    select p.id from public.plans p
    where p.circle_id = new.circle_id and p.state = 'ready'
  loop
    perform planning.transition_plan(affected, 'candidates_gone', new.user_id);
  end loop;

  -- Not coming to anything still ahead. History is left exactly as it was:
  -- `was_there` and `missed`, rows on closed confirmations, and rows on a
  -- meetup that has ended but not yet been reported on — `active` alone does
  -- not mean "ahead", and a `going` from last Thursday is part of the historic
  -- aggregate §4.5 lets remain.
  update public.attendance a
  set status = 'cant', updated_at = now()
  from public.meetup_confirmations c
  join public.plans p on p.id = c.plan_id
  where a.confirmation_id = c.id
    and a.user_id = new.user_id
    and p.circle_id = new.circle_id
    and c.status = 'active'
    and c.ends_at > now()
    and a.status in ('going', 'unknown');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Members read all three tables for their circles. A member writes their own
-- attendance row and nothing else directly; the organiser reports an outcome
-- through `report_outcome`; nobody inserts a confirmation from a client —
-- `confirm-meetup` does, as the service role, and even it cannot move a
-- confirmation's status.
-- ---------------------------------------------------------------------------

alter table public.meetup_confirmations enable row level security;
alter table public.attendance enable row level security;
alter table public.outcome_reports enable row level security;

create policy meetup_confirmations_select_member on public.meetup_confirmations
  for select to authenticated
  using (exists (
    select 1 from public.plans p where p.id = plan_id and public.auth_is_member(p.circle_id)
  ));

-- "Going / Can't / To confirm" is the circle's business: the confirmed screen
-- lists who is coming. "I was there" is not — "nobody is told who came" is on
-- the Outcome screen and "Nobody keeps score" on WasThere — so a retrospective
-- row is readable by its subject alone. Corroboration ("at least one other
-- member confirms attendance", spec §5.10) is computed for the record, never
-- shown as names; the analytics views (S1-11) read the table as owner.
create policy attendance_select_member on public.attendance
  for select to authenticated
  using (
    (user_id = (select auth.uid()) or status in ('going', 'cant', 'unknown'))
    and exists (
      select 1
      from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where c.id = confirmation_id and public.auth_is_member(p.circle_id)
    )
  );

-- Own row only, and never `unknown` by choice: "has not said" is not a thing
-- you can say. Everything else about the write — participant, timing, the
-- transition — is the trigger's.
create policy attendance_insert_own on public.attendance
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status <> 'unknown');

create policy attendance_update_own on public.attendance
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status <> 'unknown');

create policy outcome_reports_select_member on public.outcome_reports
  for select to authenticated
  using (exists (
    select 1
    from public.meetup_confirmations c
    join public.plans p on p.id = c.plan_id
    where c.id = confirmation_id and public.auth_is_member(p.circle_id)
  ));

revoke all on public.meetup_confirmations from anon, authenticated;
revoke all on public.attendance from anon, authenticated;
revoke all on public.outcome_reports from anon, authenticated;

grant select on public.meetup_confirmations to authenticated;
grant select, insert on public.attendance to authenticated;
grant update (status) on public.attendance to authenticated;
grant select on public.outcome_reports to authenticated;
grant execute on function public.report_outcome(uuid, text, text, boolean) to authenticated;

-- The service role writes confirmations (`confirm-meetup`) and the derived
-- attendance rows, and nothing moves a confirmation's `status` but the two
-- triggers above — which run as the owner. Revoke table-wide first: a column
-- revoke alone leaves the table-level grant in place.
revoke all on public.meetup_confirmations from service_role;
grant select, insert on public.meetup_confirmations to service_role;
grant update (place_name, place_url, note, chased_answer) on public.meetup_confirmations to service_role;

revoke all on function public.supersede_on_leaving_confirmed() from public;
revoke all on function public.supersede_on_leaving_confirmed() from anon, authenticated;
revoke all on function public.enforce_attendance_transition() from public;
revoke all on function public.enforce_attendance_transition() from anon, authenticated;
revoke all on function public.apply_outcome() from public;
revoke all on function public.apply_outcome() from anon, authenticated;
revoke all on function public.report_outcome(uuid, text, text, boolean) from public;
revoke all on function public.report_outcome(uuid, text, text, boolean) from anon;
