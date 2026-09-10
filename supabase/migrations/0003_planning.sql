-- Planning: the plan aggregate, and the one function allowed to move its state.
--
-- Architecture §8.3: "`planning.transition_plan(...)` … Edge Functions call it;
-- nothing else writes `plans.state`." That sentence is the whole design of this
-- migration, and the two halves of it are enforced separately:
--
--   * the function is the only thing that *may* write `state` — a trigger
--     refuses any other update to that column, so "nothing else writes it" is a
--     property of the database rather than a convention;
--   * the transition table it consults is **generated from
--     `packages/domain/src/planning/state-machine.ts`**, so the client's answer
--     to "can I do this?" and the server's cannot drift. Two state machines is
--     one state machine that disagrees with itself, usually months later.

create schema if not exists planning;

comment on schema planning is
  'The plan state machine and its transition table. Not exposed through the Data API; reachable only through security-definer functions.';

revoke all on schema planning from anon, authenticated;
alter default privileges in schema planning revoke all on tables from anon, authenticated;
alter default privileges in schema planning revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The transition table, as data.
--
-- `guards` is an array rather than the `requires_organiser` /
-- `requires_permanent` booleans this ticket first sketched. The domain has five
-- guards — `member`, `organiser`, `permanent`, `no_organiser_yet`, `candidate` —
-- and a pair of booleans would have silently dropped three of them: a mirror
-- that cannot represent the original is not a mirror. An unknown guard raises
-- rather than passing, so adding one to the domain fails loudly here.
-- ---------------------------------------------------------------------------

create table planning.transitions (
  from_state text not null,
  action text not null,
  to_state text not null,
  guards text[] not null default '{}',
  bumps_revision boolean not null default false,
  primary key (from_state, action)
);

comment on table planning.transitions is
  'Generated from packages/domain/src/planning/state-machine.ts by scripts/gen-transitions.mjs. Do not edit by hand; pnpm check:transitions fails if it drifts.';

-- BEGIN GENERATED: transitions (scripts/gen-transitions.mjs)
insert into planning.transitions (from_state, action, to_state, guards, bumps_revision) values
  ('draft', 'create_named', 'collecting', array['member','permanent'], false),
  ('draft', 'create_quiet', 'seeking', array['member','permanent'], false),
  ('seeking', 'threshold_reached', 'collecting', array[]::text[], false),
  ('seeking', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'accept_organiser', 'collecting', array['member','permanent','no_organiser_yet','keen_or_initiator'], false),
  ('ready', 'accept_organiser', 'ready', array['member','permanent','no_organiser_yet','keen_or_initiator'], false),
  ('seeking', 'cancel', 'cancelled', array['initiator'], false),
  ('collecting', 'candidates_ready', 'ready', array[]::text[], false),
  ('collecting', 'edit', 'collecting', array['organiser'], true),
  ('collecting', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'cancel', 'cancelled', array['organiser'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('ready', 'expire', 'expired', array[]::text[], false),
  ('ready', 'cancel', 'cancelled', array['organiser'], false),
  ('confirmed', 'reopen', 'collecting', array['organiser'], true),
  ('confirmed', 'cancel', 'cancelled', array['organiser'], false),
  ('confirmed', 'report_outcome', 'completed', array['organiser'], false);
-- END GENERATED: transitions

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  mode text not null,
  state text not null default 'draft',
  -- Null on a quiet ask until somebody accepts the role (ADR 0004, §6.2). Null
  -- is also the whole of the confidentiality design.
  --
  -- There is deliberately **no `created_by`**. It was here, and it was the leak:
  -- on a quiet ask the creator *is* the initiator, `plans` is readable by every
  -- member, and `private.plan_initiators` protects a fact the public row was
  -- handing out beside it. For a named plan the column said nothing
  -- `organiser_user_id` did not; for a quiet one it said the one thing that must
  -- never be said. Who created a plan belongs in the outbox event and the audit
  -- log (S1-11), which no client reads.
  organiser_user_id uuid references auth.users (id),
  title text not null,
  category text not null default 'catch_up',
  time_zone text not null,
  window_start date not null,
  window_end date not null,
  -- Minutes since local midnight. `daily_end_local` may be 1440 — a band that
  -- runs to midnight ends at 24:00, which no clock reads but every calendar
  -- needs.
  daily_start_local integer not null,
  daily_end_local integer not null,
  duration_minutes integer not null,
  quorum integer not null,
  response_deadline timestamptz not null,
  quiet_threshold integer,
  quiet_expires_at timestamptz,
  -- Bumped by an edit or a reopen: the *question* changed, so the answers to
  -- the old one stop counting.
  revision integer not null default 1,
  -- Bumped every time an *answer* changes within the current revision
  -- (architecture §9.1). `submit-availability` raises it;
  -- `recalculate-candidates` persists only if it is still current, and `confirm`
  -- refuses a candidate set computed against an older one. Not in §8.2's column
  -- list, and `candidate_sets` is keyed on it there, so it has to live here for
  -- "still current" to mean anything.
  input_version integer not null default 1,
  scoring_version integer not null default 1,
  short_code text not null unique,
  -- The optional note from the CancelPlan screen. Never shown to explain a
  -- quiet ask's withdrawal, which is closed privately (§5.4).
  cancel_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plans_mode check (mode in ('named', 'quiet')),
  constraint plans_state check (state in (
    'draft', 'seeking', 'collecting', 'ready', 'confirmed', 'completed', 'expired', 'cancelled'
  )),
  constraint plans_category check (
    category in ('catch_up', 'dinner', 'drinks', 'coffee', 'activity')
  ),
  constraint plans_title_length check (char_length(btrim(title)) between 1 and 60),
  constraint plans_window_order check (window_end >= window_start),
  -- "Custom (calendar picker, capped at 14 consecutive days)" (spec §5.3).
  -- Inclusive, so the 14th day is allowed and the 15th is not.
  constraint plans_window_length check (window_end - window_start <= 13),
  constraint plans_daily_bounds check (
    daily_start_local >= 0 and daily_end_local <= 1440 and daily_start_local < daily_end_local
  ),
  -- Half-hour aligned, because the whole product is: a band starting at 6:07
  -- would make every candidate start land somewhere nobody offers to meet.
  constraint plans_daily_aligned check (
    daily_start_local % 30 = 0 and daily_end_local % 30 = 0
  ),
  constraint plans_duration check (duration_minutes in (60, 90, 120, 180)),
  -- The band has to hold the meetup, or the last possible start is before the
  -- band opens.
  constraint plans_band_fits check (daily_end_local - daily_start_local >= duration_minutes),
  constraint plans_quorum check (quorum >= 2),
  constraint plans_quiet_threshold check (
    (mode = 'quiet' and quiet_threshold >= 2) or (mode = 'named' and quiet_threshold is null)
  ),
  constraint plans_revision check (revision >= 1),
  constraint plans_input_version check (input_version >= 1),
  constraint plans_short_code_shape check (short_code ~ '^[a-hjkmnp-z2-9]{6,12}$'),
  -- A cancel note belongs to a cancelled plan. Anywhere else it is a note
  -- nobody will ever read, attached to a plan that did not end.
  constraint plans_cancel_note_when_cancelled check (
    cancel_note is null or state = 'cancelled'
  )
);

comment on table public.plans is
  'One attempt by a circle to meet. `state` is written only by planning.transition_plan(); plans_state_guard refuses any other update to it.';

create index plans_circle_idx on public.plans (circle_id);
create index plans_open_idx on public.plans (circle_id)
  where state in ('seeking', 'collecting', 'ready', 'confirmed');
create index plans_deadline_idx on public.plans (response_deadline)
  where state in ('collecting', 'ready');

-- ---------------------------------------------------------------------------
-- Who the plan was addressed to, and who has to be there.
--
-- Two different lists, and conflating them was the bug SUS-22 found in the
-- notification rules: a member who joined the circle on Tuesday is not a
-- non-responder to a question asked on Monday. Spec §9 makes joining an active
-- plan an *opt-in*, so participation is a fact recorded here rather than
-- derived from `circle_members`.
-- ---------------------------------------------------------------------------

create table public.plan_participants (
  plan_id uuid not null references public.plans (id) on delete cascade,
  revision integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (plan_id, revision, user_id)
);

comment on table public.plan_participants is
  'Who a plan revision was addressed to: the circle''s active members when it was created, plus anyone who has since opted into it (spec §9).';

create index plan_participants_user_idx on public.plan_participants (user_id);

create table public.plan_required_members (
  plan_id uuid not null references public.plans (id) on delete cascade,
  revision integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (plan_id, revision, user_id)
);

comment on table public.plan_required_members is
  'Members without whom no time is eligible. Counted toward quorum; the organiser is required by default (spec §5.3).';

-- ---------------------------------------------------------------------------
-- The quiet ask's two secrets.
--
-- Both in `private`, which no client role may even `usage` on. That is the
-- entire mechanism: "quiet-ask initiator identity and individual interest
-- answers are never exposed" is true because there is no path, not because
-- every query remembered to exclude them.
-- ---------------------------------------------------------------------------

create table private.plan_initiators (
  plan_id uuid primary key references public.plans (id) on delete cascade,
  initiator_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table private.plan_initiators is
  'Who started a quiet ask. Never selectable by a client, never in an event payload, never in a log (§14).';

create table private.plan_interest (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  response text not null,
  responded_at timestamptz not null default now(),
  primary key (plan_id, user_id),
  constraint plan_interest_response check (response in ('keen', 'not_this_time'))
);

comment on table private.plan_interest is
  'Individual answers to a quiet ask. Exposed to clients only as a count, and only after threshold — see public.plan_interest_counts.';

create index plan_interest_keen_idx on private.plan_interest (plan_id) where response = 'keen';

-- ---------------------------------------------------------------------------
-- plan_interest_counts
--
-- A count, and only once the ask is no longer `seeking`.
--
-- Deliberately not `security_invoker`: the point is to expose an aggregate over
-- a table the caller may not read at all, which is exactly what RLS cannot
-- express. The `state <> 'seeking'` filter is the confidentiality rule — before
-- threshold, a count that moves from 2 to 3 while one person is watching names
-- that person to anybody who was also watching.
-- ---------------------------------------------------------------------------

create view public.plan_interest_counts as
select
  p.id as plan_id,
  count(*) filter (where i.response = 'keen')::integer as keen_count
from public.plans p
join private.plan_interest i on i.plan_id = p.id
-- Only the states a plan can reach *through* `threshold_reached`. `expired` and
-- `cancelled` are both reachable directly from `seeking` — an ask that ran out
-- of time, or one its initiator withdrew — and `state <> 'seeking'` would have
-- published a below-threshold count for exactly those two. In a circle of six,
-- "one person was keen" is close to naming them.
where p.state in ('collecting', 'ready', 'confirmed', 'completed')
  and public.auth_is_member(p.circle_id)
group by p.id;

comment on view public.plan_interest_counts is
  'Keen counts for quiet asks that have passed threshold. No row while seeking, none for an ask that expired or was withdrawn below it, and never an individual answer.';

revoke all on public.plan_interest_counts from anon, authenticated;
grant select on public.plan_interest_counts to authenticated;

-- ---------------------------------------------------------------------------
-- The deadline is never after the last possible start.
--
-- Architecture §8.2 lists it as a constraint on `plans`, and it cannot be a
-- `check`: the last possible start is a wall-clock time in the plan's zone, and
-- `at time zone` is stable rather than immutable — the tz database can change
-- under a stored row.
-- ---------------------------------------------------------------------------

create or replace function public.plan_last_possible_start(
  window_end date,
  daily_end_local integer,
  duration_minutes integer,
  time_zone text
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  -- Minutes added to midnight rather than a constructed time, so a band ending
  -- at 1440 rolls into the next day instead of failing to be a clock reading.
  select (
    plan_last_possible_start.window_end::timestamp
      + make_interval(mins => plan_last_possible_start.daily_end_local
                              - plan_last_possible_start.duration_minutes)
  ) at time zone plan_last_possible_start.time_zone;
$$;

comment on function public.plan_last_possible_start(date, integer, integer, text) is
  'The latest instant the meetup could still begin. Mirrors lastPossibleStart() in packages/domain/src/planning/deadline.ts.';

create or replace function public.enforce_plan_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest_start timestamptz := public.plan_last_possible_start(
    new.window_end, new.daily_end_local, new.duration_minutes, new.time_zone
  );
begin
  if new.response_deadline > latest_start then
    raise exception 'response deadline % is after the last possible start %',
      new.response_deadline, latest_start
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_plan_deadline() is
  'A deadline never runs past the last possible start (spec §5.3): replies that arrive once the plan cannot happen are replies to nothing.';

create trigger plans_deadline_within_window
  before insert or update of response_deadline, window_end, daily_end_local, duration_minutes, time_zone
  on public.plans
  for each row execute function public.enforce_plan_deadline();

create trigger plans_iana_zone
  before insert or update of time_zone on public.plans
  for each row execute function public.enforce_iana_zone('time_zone');

create trigger plans_touch_updated_at
  before update on public.plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Nothing else writes `state`.
--
-- Two mechanisms, because neither covers the other's case.
--
-- **A column privilege**, revoked from `service_role` below. That is the caller
-- the Edge Functions run as, and it is the one that matters: a `set_config`
-- marker is a *convention*, and any caller that can update the table can set it
-- first. Privileges cannot be manufactured by the code they restrain.
--
-- **The trigger**, for the case a privilege cannot reach: the table's owner,
-- which is `postgres` — migrations, psql, and `transition_plan` itself. The
-- marker is honest there, because at that point the caller is trusted and what
-- is being prevented is a mistake rather than an attack.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_state_through_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state
     and coalesce(current_setting('circles.in_transition', true), '') <> 'on' then
    raise exception 'plans.state is written only by planning.transition_plan()'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

comment on function public.enforce_state_through_transition() is
  'Refuses any update to plans.state from outside planning.transition_plan(), which sets circles.in_transition for the length of its own transaction.';

create trigger plans_state_guard
  before update of state on public.plans
  for each row execute function public.enforce_state_through_transition();

-- ---------------------------------------------------------------------------
-- transition_plan
--
-- Takes the row lock first, resolves who the actor is *from the database*
-- rather than from the payload, evaluates the generated table, applies the
-- payload, and returns the new row.
-- ---------------------------------------------------------------------------

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
  -- The lock comes first: two Edge Functions confirming the same plan at once
  -- would otherwise both read `ready` and both write `confirmed`.
  select * into plan from public.plans where id = p_plan_id for update;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into rule
  from planning.transitions t
  where t.from_state = plan.state and t.action = p_action;

  if not found then
    -- A finished plan gets its own code: "not right now" is misleading when the
    -- answer is "not ever". The domain's `canTransition` says the same.
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

  foreach guard in array rule.guards loop
    case guard
      when 'member' then
        if member.user_id is null then
          raise exception 'not_a_member' using errcode = 'P0001';
        end if;
      when 'organiser' then
        -- Membership as well as the role. An organiser removed from the circle
        -- while their plan is still open would otherwise keep confirming,
        -- editing and cancelling it: "removal revokes access immediately"
        -- (§6.2) has to include the plan they were running.
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
        -- Read from `private.plan_initiators`, which is why this check belongs
        -- in a definer function: the fact has to be *checkable* without being
        -- *readable*, and there is nowhere else it could live without the plan
        -- row carrying it (spec §5.4, §8.2).
        if not exists (
          select 1 from private.plan_initiators pi
          where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
        ) then
          raise exception 'not_the_initiator' using errcode = 'P0001';
        end if;
      when 'keen_or_initiator' then
        -- Architecture §9.1: "accept-organiser | keen member (quiet) or
        -- initiator". Somebody who answered `not_this_time`, or never answered,
        -- is not being offered the job of arranging it.
        if not exists (
          select 1 from private.plan_interest i
          where i.plan_id = plan.id and i.user_id = p_actor and i.response = 'keen'
        ) and not exists (
          select 1 from private.plan_initiators pi
          where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
        ) then
          raise exception 'not_keen_or_initiator' using errcode = 'P0001';
        end if;
      when 'candidate' then
        -- Presence, not eligibility — and presence is not the property this
        -- guard claims. The domain requires the id to be in the *current*
        -- eligible set, because a candidate can stop being eligible between the
        -- organiser opening the review screen and tapping the button.
        --
        -- `public.candidates` lands in S1-09, so the real check cannot be
        -- written yet. `040_candidate_guard_dependency.sql` fails the build the
        -- day that table appears, with the query to write in its message.
        if coalesce(p_payload ->> 'candidate_id', '') = '' then
          raise exception 'needs_candidate' using errcode = 'P0001';
        end if;
      else
        -- A guard the domain has and this function does not. Failing closed is
        -- the only safe reading: the alternative is a rule silently not applied.
        raise exception 'UNKNOWN_GUARD_%', guard using errcode = 'P0001';
    end case;
  end loop;

  next_revision := plan.revision + (case when rule.bumps_revision then 1 else 0 end);

  -- The one transition that appoints an organiser. Every other one leaves the
  -- organiser alone: an edit or a reopen does not hand the plan to somebody else.
  perform set_config('circles.in_transition', 'on', true);

  update public.plans p set
    state = rule.to_state,
    revision = next_revision,
    -- A new revision is a new question, so the answers start again.
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

  -- TODO(S1-11): write the planning.* outbox event for this action here, in
  -- this transaction. `jobs.outbox` lands in S1-11 and
  -- `020_outbox_dependency.sql` fails the build the day it does.

  return plan;
end;
$$;

comment on function planning.transition_plan(uuid, text, uuid, jsonb) is
  'The only writer of plans.state (architecture §8.3). Evaluates planning.transitions, which is generated from the domain state machine.';

revoke all on function planning.transition_plan(uuid, text, uuid, jsonb) from public;
revoke all on function planning.transition_plan(uuid, text, uuid, jsonb) from anon, authenticated;

-- The Edge Functions are the caller (architecture §9.1), and they hold
-- `service_role`. A custom schema grants no `usage` by default, so without
-- these two lines the documented path returns a permission error rather than a
-- transition — the function existed and nothing could reach it.
grant usage on schema planning to service_role;
grant execute on function planning.transition_plan(uuid, text, uuid, jsonb) to service_role;

revoke all on function public.plan_last_possible_start(date, integer, integer, text) from public;
revoke all on function public.plan_last_possible_start(date, integer, integer, text)
  from anon, authenticated;
revoke all on function public.enforce_plan_deadline() from public;
revoke all on function public.enforce_plan_deadline() from anon, authenticated;
revoke all on function public.enforce_state_through_transition() from public;
revoke all on function public.enforce_state_through_transition() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Reads for members; no client writes at all. Every change to a plan goes
-- through `transition_plan` or an Edge Function, because every change to a plan
-- has a rule attached to it.
-- ---------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.plan_participants enable row level security;
alter table public.plan_required_members enable row level security;
alter table private.plan_initiators enable row level security;
alter table private.plan_interest enable row level security;

-- A quiet ask in `seeking` is visible to the whole circle, which is the point:
-- everyone is being asked. What is not visible is who asked — there is no
-- column here to read, and `organiser_user_id` is null until somebody accepts.
create policy plans_select_member on public.plans
  for select to authenticated
  using (public.auth_is_member(circle_id));

create policy plan_participants_select_member on public.plan_participants
  for select to authenticated
  using (exists (
    select 1 from public.plans p where p.id = plan_id and public.auth_is_member(p.circle_id)
  ));

create policy plan_required_members_select_member on public.plan_required_members
  for select to authenticated
  using (exists (
    select 1 from public.plans p where p.id = plan_id and public.auth_is_member(p.circle_id)
  ));

-- No policies at all on the two private tables. RLS is enabled on them anyway:
-- the schema grant is the real defence, and this is the second one, so a future
-- grant does not silently open them.

revoke all on public.plans from anon, authenticated;
revoke all on public.plan_participants from anon, authenticated;
revoke all on public.plan_required_members from anon, authenticated;

-- `state` is not writable by the role the Edge Functions run as.
--
-- The table-wide grant has to go first: revoking one *column* leaves a
-- table-level `update` in place, and a table-level update covers every column.
-- What is granted back is the pair of counters an Edge Function legitimately
-- moves without a transition — `submit-availability` bumps `input_version`
-- (§9.1) and `recalculate-candidates` records the engine version it used.
-- Everything else about a plan changes through `transition_plan`, which runs as
-- the table's owner and so is not restrained by this. That is the point: the
-- function is the exception, and it is one the caller cannot grant themselves.
--
-- This covers `update`. A service-role `insert` can still choose a starting
-- state — every plan should be born in `draft` and walk from there — and that
-- is closed when `create-plan` becomes a definer RPC beside `create_circle`
-- (S1-15, noted on SUS-31).
revoke update on public.plans from service_role;
grant update (input_version, scoring_version) on public.plans to service_role;

grant select on public.plans to authenticated;
grant select on public.plan_participants to authenticated;
grant select on public.plan_required_members to authenticated;
