-- ---------------------------------------------------------------------------
-- 0019 — a quorum nobody chose follows the circle (ADR 0026, S1-22b).
--
-- First run now shares the *plan's* link rather than an invite, so a plan is
-- made on a circle of one and the friends who answer it arrive afterwards. A
-- quorum resolved once, at creation, from a member count of one is a number
-- about nobody: `plans.quorum_source` records whether anybody meant it, and
-- `public.join_from_plan` moves the ones nobody did.
--
-- Three parts:
--
-- 1. `plans.quorum_source`, defaulting to `chosen` — every plan that exists
--    today had its quorum resolved by an organiser or by the circle's default
--    at a moment when the circle was real, and none of them should start moving
--    now.
-- 2. The state machine, reseeded, for `quorum_follows`: the same write as
--    `adjust` with no guard and no event, because the person who moves it is
--    the one who just tapped the link and the join was announced already.
-- 3. The functions that read and write it, carried from
--    `supabase/sql/functions/` as ADR 0015 requires.
--
-- A new migration rather than a regenerated `0018`, because `0018` has shipped.
-- ---------------------------------------------------------------------------

alter table public.plans
  add column quorum_source text not null default 'chosen';

alter table public.plans
  add constraint plans_quorum_source check (quorum_source in ('chosen', 'defaulted'));

comment on column public.plans.quorum_source is
  'Whether the quorum is a number somebody meant (chosen: the request or the circle supplied it) or a placeholder that follows the circle as people join (defaulted). Written only by planning.transition_plan (ADR 0026).';

-- The state machine, reseeded.
--
-- 0011 has shipped, so a domain change cannot be regenerated in place, and
-- `MIGRATION` in `scripts/gen-transitions.mjs` now points here. Emptied and
-- rewritten rather than patched: it is a mirror of
-- `packages/domain/src/planning/state-machine.ts`, and a mirror with one row
-- amended by hand is no longer one.
--
-- What changed: `quorum_follows`, from `collecting` and from `ready`.
-- ---------------------------------------------------------------------------
delete from planning.transitions;

-- BEGIN GENERATED: transitions (scripts/gen-transitions.mjs)
insert into planning.transitions (from_state, action, to_state, guards, bumps_revision) values
  ('draft', 'create_named', 'collecting', array['member','permanent'], false),
  ('draft', 'create_quiet', 'seeking', array['member','permanent'], false),
  ('seeking', 'threshold_reached', 'collecting', array['threshold'], false),
  ('seeking', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'accept_organiser', 'collecting', array['member','permanent','no_organiser_yet','keen_initiator_or_owner'], false),
  ('ready', 'accept_organiser', 'ready', array['member','permanent','no_organiser_yet','keen_initiator_or_owner'], false),
  ('seeking', 'cancel', 'cancelled', array['member','initiator'], false),
  ('collecting', 'candidates_ready', 'ready', array[]::text[], false),
  ('collecting', 'edit', 'collecting', array['organiser'], true),
  ('collecting', 'adjust', 'collecting', array['organiser'], false),
  ('collecting', 'quorum_follows', 'collecting', array[]::text[], false),
  ('collecting', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'adjust', 'ready', array['organiser'], false),
  ('ready', 'quorum_follows', 'ready', array[]::text[], false),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('ready', 'expire', 'expired', array[]::text[], false),
  ('ready', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'reopen', 'collecting', array['organiser'], true),
  ('confirmed', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'report_outcome', 'completed', array['organiser'], false);
-- END GENERATED: transitions

-- `create_plan` gains `p_quorum_source`, which is a new signature rather than a
-- replacement: `create or replace` would leave the ten-argument version behind
-- and every existing call — all of which pass ten arguments — would become
-- ambiguous. Dropped first, as `issue_reentry_token` was in 0018.
drop function if exists public.create_plan(
  uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[]
);

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/planning/allowed_keys.sql
-- The payload keys an action may carry. Anything else is refused, not ignored:
-- a caller that sends `quorum` with a `cancel` has misunderstood something,
-- and silently dropping it would let the misunderstanding ship.
--
-- `confirm` carries the confirmation's details as well as the candidate,
-- because `transition_plan` writes the confirmation row itself.

create or replace function planning.allowed_keys(action text)
returns text[]
language sql
immutable
as $$
  select case
    -- `adjust` takes these two and *only* these two, which is what makes the
    -- split between "changes the question" and "changes what happens to the
    -- answers" structural rather than a comparison somebody has to remember
    -- (spec §5.3). A window cannot ride along on an adjustment.
    when action = 'adjust' then array['quorum', 'response_deadline']
    -- The quorum alone. `quorum_follows` is the circle moving a quorum nobody
    -- chose (ADR 0026); a deadline riding along on it would be a change no
    -- organiser asked for and nobody announced.
    when action = 'quorum_follows' then array['quorum']
    when action in ('edit', 'reopen') then array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local',
      'duration_minutes', 'quorum', 'response_deadline'
    ]
    when action = 'cancel' then array['cancel_note']
    when action = 'confirm' then array['candidate_id', 'place_name', 'place_url', 'note', 'chased_answer']
    else array[]::text[]
  end;
$$;

revoke all on function planning.allowed_keys(text) from public;
revoke all on function planning.allowed_keys(text) from anon, authenticated;

-- supabase/sql/functions/planning/event_for.sql
-- The transition → event map. Immutable and total over `planning.transitions`;
-- `075_outbox_events.sql` walks that table and fails if a row maps to null,
-- so a transition added by the generator cannot arrive silent.

create or replace function planning.event_for(p_from_state text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'create_named' then 'planning.plan_created'
    when 'create_quiet' then 'planning.quiet_ask_created'
    when 'threshold_reached' then 'planning.threshold_reached'
    when 'expire' then 'planning.plan_expired'
    when 'accept_organiser' then 'planning.organiser_accepted'
    when 'edit' then 'planning.plan_revised'
    -- The same event. What the circle is told is "the plan changed"; that this
    -- change cost nobody a second reply is the *absence* of a re-ask, which the
    -- notification rules read from the revision rather than from the name.
    when 'adjust' then 'planning.plan_revised'
    when 'candidates_ready' then 'scheduling.candidates_generated'
    -- `candidates_gone` is the engine's bookkeeping: an answer moved, the set
    -- is stale, a recalculation follows. It says nothing about whether options
    -- exist, so it announces nothing — `scheduling.no_eligible_candidates` is
    -- the recalculation's to emit, from what it actually found (S1-16).
    when 'candidates_gone' then null
    -- Nor is a quorum that followed the circle (ADR 0026). `adjust` is an
    -- organiser changing the plan, which the circle is told about; this is the
    -- plan's own default keeping up with a join that was announced already
    -- (`identity.member_joined`). Announcing it too would tell six people "the
    -- plan changed" every time a seventh tapped the link.
    when 'quorum_follows' then null
    when 'confirm' then 'confirmation.meetup_confirmed'
    when 'reopen' then 'confirmation.meetup_rescheduled'
    when 'report_outcome' then 'confirmation.outcome_reported'
    -- Cancelling a confirmed meetup is a different message from withdrawing
    -- an ask: "Thursday is off" goes to everyone who had it in a calendar.
    --
    -- And withdrawing a quiet ask before threshold is not a message at all:
    -- "closed privately, nobody told" (spec §9). The circle was never told the
    -- ask existed — `planning.quiet_ask_created` is addressed to the circle
    -- without naming who — so an event saying it has been cancelled tells them
    -- both that it existed and, by its timing, who ended it (§14).
    when 'cancel' then case p_from_state
      when 'confirmed' then 'confirmation.meetup_cancelled'
      when 'seeking' then null
      else 'planning.plan_cancelled'
    end
    else null
  end;
$$;

comment on function planning.event_for(text, text) is
  'The outbox event a transition announces. Total over planning.transitions except the named silent bookkeeping actions, by test.';

revoke all on function planning.event_for(text, text) from public;
revoke all on function planning.event_for(text, text) from anon, authenticated;

-- supabase/sql/functions/planning/transition_plan.sql
-- transition_plan, redefined whole from 0004 with the emit in place of the
-- TODO. The body is otherwise byte-for-byte 0004's; the diff of this file
-- against that one is the review.

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
  event_name text;
  event_payload jsonb;
  confirmation_id uuid;
begin
  select * into plan from public.plans where id = p_plan_id for update;
  if not found then
    -- Lower case, like every other name raised here. `_shared/problem.ts` maps
    -- an exception's text to a `ProblemReason` by exact match, so the shout was
    -- the one refusal no endpoint could translate: `cancel-plan` answered 500
    -- for a plan that simply is not there, where its own contract says 404.
    raise exception 'plan_not_found' using errcode = 'P0001';
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

  -- The one key whose acceptability depends on the state it is used in, so
  -- `allowed_keys` cannot say it. A cancel note is something to tell people, and
  -- a quiet ask withdrawn before threshold tells nobody (spec §9) — while
  -- `plans` is readable by the whole circle, so a note left on the row is the
  -- announcement in another form, with the initiator's own words in it.
  --
  -- Its own name rather than `unexpected_payload`, which no endpoint can
  -- translate: `cancel-plan` takes an optional note for every plan, so a client
  -- that offers one here is wrong in a way a person should be told about — and
  -- answering 500 left the ask open as well.
  if rule.from_state = 'seeking' and p_action = 'cancel' and p_payload ? 'cancel_note' then
    raise exception 'note_not_allowed' using errcode = 'P0001';
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
      when 'organiser_or_owner' then
        -- Spec §4.5 gives the circle owner "cancel plans" in as many words, and
        -- the organiser-only guard took it away the moment a plan had an
        -- organiser who was not the owner. Membership as well as the role: a
        -- removed owner is not an owner of anything they can still act on.
        if member.user_id is null or (
          plan.organiser_user_id is distinct from p_actor
          and not exists (
            select 1 from public.circles c
            where c.id = plan.circle_id and c.owner_user_id = p_actor
          )
        ) then
          raise exception 'not_the_organiser_or_owner' using errcode = 'P0001';
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
        -- `confirm()` in the domain: a candidate that begins in the past is
        -- removed on recalculation (spec §9), and confirming one in the
        -- meantime would lock in a time that has gone. Eligibility is about
        -- the set; this is about the clock, and it is checked here too.
        if (p_payload ->> 'candidate_id')::timestamptz <= now() then
          raise exception 'candidate_has_passed' using errcode = 'P0001';
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
    input_version = case
      when rule.bumps_revision then 1
      -- A quorum change makes the stored candidate set *wrong*, and nothing else
      -- would have noticed: `candidate_is_eligible` checks the set's versions and
      -- the near-miss flag and never reads the plan's quorum, so raising it from
      -- four to five left a four-person candidate confirmable. Bumping the input
      -- version is the narrow way to say "recompute": it does not touch the
      -- revision, so nobody is asked again, and it does not touch the answers.
      when p_payload ? 'quorum' then p.input_version + 1
      else p.input_version
    end,
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
    -- Who the number belongs to (ADR 0026). An organiser writing one — through
    -- `adjust`, or carried on an `edit` or a `reopen` — makes it theirs, and it
    -- stops following the circle from then on, including back down and
    -- including when the circle grows. `quorum_follows` is the rule itself
    -- writing, so it leaves the source alone; that is the whole difference
    -- between the two actions.
    quorum_source = case
      when p_action = 'quorum_follows' then p.quorum_source
      when p_payload ? 'quorum' then 'chosen'
      else p.quorum_source
    end,
    response_deadline = coalesce((p_payload ->> 'response_deadline')::timestamptz, p.response_deadline),
    cancel_note = case
      when rule.to_state = 'cancelled' then p_payload ->> 'cancel_note'
      else p.cancel_note
    end
  where p.id = p_plan_id
  returning * into plan;

  perform set_config('circles.in_transition', 'off', true);

  -- A new revision is a new question, asked of the same people. Nothing used to
  -- carry them across, so an edited plan arrived at revision 2 addressed to
  -- nobody: `replace_response` refuses a member who is not a participant of the
  -- current revision, so *no one could answer it*, and `reask_audience` had
  -- nobody to name. The gap was unreachable until S1-15 gave anyone a way to
  -- edit a plan.
  --
  -- The audience is carried rather than recomputed from `circle_members`, and
  -- the difference matters: spec §9 makes joining an active plan an opt-in, so
  -- somebody who joined the circle after the plan was created is not silently
  -- added to it by the organiser fixing a date.
  --
  -- Filtered on active membership all the same, and the comment here used to
  -- say instead that it did not need to be: `on_member_removed` takes a removed
  -- member out of the revisions of `seeking`, `collecting` and `ready` plans,
  -- and deliberately leaves the rows on a `confirmed` one, because the
  -- confirmation's attendance is about who was there. `reopen` is the transition
  -- that crosses that line — from `confirmed`, bumping the revision — so it was
  -- the one case where the assumption was false, and it copied somebody who had
  -- left into a live revision. `reask_audience` then named them, and required
  -- of them, a plan can wait for an answer that cannot come.
  if rule.bumps_revision then
    insert into public.plan_participants (plan_id, revision, user_id, joined_at)
    select plan.id, plan.revision, pp.user_id, pp.joined_at
    from public.plan_participants pp
    where pp.plan_id = plan.id and pp.revision = plan.revision - 1
      and exists (
        select 1 from public.circle_members m
        where m.circle_id = plan.circle_id and m.user_id = pp.user_id and m.status = 'active'
      );

    -- Required members are carried *unfiltered*, which is the opposite of the
    -- line above and deliberately so. Spec §9: "a required person leaves: the
    -- plan becomes ineligible until the organiser changes required members or
    -- cancels." `on_member_removed` leaves the row for exactly that reason, and
    -- dropping it here would have let an unrelated edit to the window quietly
    -- make the plan eligible again — neither of the two things §9 says have to
    -- happen, and nobody would have been told either.
    --
    -- The two tables answer different questions. Participants are who is being
    -- asked, and asking somebody who has left is meaningless. Required members
    -- are a condition on the answer, and a condition does not stop applying
    -- because the person it names walked away.
    insert into public.plan_required_members (plan_id, revision, user_id)
    select plan.id, plan.revision, rm.user_id
    from public.plan_required_members rm
    where rm.plan_id = plan.id and rm.revision = plan.revision - 1;
  end if;

  -- `confirm` is not a state change with a row to follow; it is the row. The
  -- frozen copy of the candidate and the derived attendance are written here,
  -- in the transaction that moves the plan and announces it, so that there is
  -- no moment at which a plan is `confirmed` with nothing confirmed — and no
  -- event about a confirmation that a later insert might fail to create. The
  -- candidate was proven eligible by the guard above; this reads the same row.
  if p_action = 'confirm' then
    insert into public.meetup_confirmations (
      plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids,
      place_name, place_url, note, chased_answer, confirmed_by
    )
    select plan.id, plan.revision, p_payload ->> 'candidate_id', c.starts_at, c.ends_at, c.available_user_ids,
      p_payload ->> 'place_name', p_payload ->> 'place_url', p_payload ->> 'note', p_payload ->> 'chased_answer',
      p_actor
    from public.candidate_sets cs
    join public.candidates c on c.candidate_set_id = cs.id
    where cs.plan_id = plan.id
      and cs.revision = plan.revision
      and cs.input_version = plan.input_version
      and cs.scoring_version = plan.scoring_version
      and not c.is_near_miss
      and c.starts_at = (p_payload ->> 'candidate_id')::timestamptz
    returning id into confirmation_id;

    -- `deriveAttendance`: `going` for anyone frozen in as available, `cant` for
    -- anyone who answered this revision and is not, `unknown` for anyone who
    -- never answered. Derived, not said — the marker keeps the attendance
    -- trigger from announcing the organiser's own row as a fresh answer.
    perform set_config('circles.deriving_attendance', 'on', true);
    insert into public.attendance (confirmation_id, user_id, status)
    select confirmation_id, pp.user_id,
      case
        when pp.user_id = any (c.available_user_ids) then 'going'
        when exists (
          select 1 from public.plan_responses r
          where r.plan_id = plan.id and r.revision = plan.revision and r.user_id = pp.user_id
        ) then 'cant'
        else 'unknown'
      end
    from public.plan_participants pp
    cross join (select available_user_ids from public.meetup_confirmations where id = confirmation_id) c
    where pp.plan_id = plan.id and pp.revision = plan.revision;
    perform set_config('circles.deriving_attendance', 'off', true);
  end if;

  -- The event, in the same transaction as the change (ADR 0003). Its name
  -- comes from the transition, not from the caller, and a transition without
  -- a name is refused rather than silently unannounced — `075_outbox_events`
  -- walks the table so a new row cannot arrive without one. The two silences
  -- are named here and there: `candidates_gone`, and a quiet ask withdrawn
  -- before threshold, which spec §9 closes "privately, nobody told". See
  -- `event_for`. The third is `quorum_follows`: a quorum nobody chose keeping
  -- up with a join the circle has already been told about (ADR 0026).
  --
  -- The list is here *and* in `event_for` because either one alone is a lie:
  -- `event_for` returning null is how a silence is expressed, and this check is
  -- what stops a new transition being silent by accident. A silence has to be
  -- written in both places, which is the point.
  event_name := planning.event_for(rule.from_state, p_action);
  if event_name is null
    and not (
      p_action in ('candidates_gone', 'quorum_follows')
      or (p_action = 'cancel' and rule.from_state = 'seeking')
    )
  then
    raise exception 'no outbox event for transition % / %', rule.from_state, p_action
      using errcode = 'P0001';
  end if;

  -- What the payload may say. The actor is never named as such: on a quiet ask
  -- the actor of `create_quiet` and of `cancel` is the initiator, whose
  -- identity is the one thing the row must never say (§14). The organiser is a
  -- public fact and is carried once accepted; a threshold event carries the
  -- plan and the keen count only (§6.3).
  event_payload := jsonb_build_object(
    'plan_id', plan.id,
    'circle_id', plan.circle_id,
    'mode', plan.mode,
    'action', p_action,
    'from_state', rule.from_state,
    'to_state', plan.state,
    'revision', plan.revision
  );
  if plan.organiser_user_id is not null then
    event_payload := event_payload || jsonb_build_object('organiser_user_id', plan.organiser_user_id);
  end if;
  if p_action = 'threshold_reached' then
    event_payload := event_payload || jsonb_build_object('keen_count', (
      select count(*) from private.plan_interest i
      where i.plan_id = plan.id and i.response = 'keen'
    ));
  end if;
  if p_action = 'confirm' then
    event_payload := event_payload || jsonb_build_object('candidate_id', p_payload ->> 'candidate_id');
  end if;
  if event_name is not null then
    perform jobs.emit(event_name, 'plan', plan.id, event_payload);
  end if;


  return plan;
end;
$$;

revoke all on function planning.transition_plan(uuid, text, uuid, jsonb) from public;
revoke all on function planning.transition_plan(uuid, text, uuid, jsonb) from anon, authenticated;
grant execute on function planning.transition_plan(uuid, text, uuid, jsonb) to service_role;

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
  p_quorum integer,
  p_response_deadline timestamptz,
  -- Absent means "the organiser alone", which is spec §5.3's default. An empty
  -- array is a different answer — nobody is required — and is kept as one.
  p_required_member_ids uuid[] default null,
  -- Whether `p_quorum` is a number somebody meant. `defaulted` is what the
  -- caller passes when neither the request nor the circle supplied one, and it
  -- is the only kind that follows the circle as people join (ADR 0026). The
  -- caller decides because only the caller can see the request; the default
  -- here is the conservative one, so a caller that has not been taught about
  -- the flag gets a quorum that stays put.
  p_quorum_source text default 'chosen'
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
    p_duration_minutes, p_quorum, p_quorum_source, p_response_deadline, code
  )
  returning * into created;

  -- Who it was addressed to: the circle's active members at this moment. A
  -- fact, not a derivation — somebody who joins on Tuesday is not a
  -- non-responder to a question asked on Monday (0003's own comment, and
  -- spec §9 makes joining an active plan an opt-in).
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
  -- member with a saved place — run here, so an anonymous caller's plan is
  -- rolled back rather than left behind.
  return planning.transition_plan(created.id, 'create_named', caller);
end;
$$;

comment on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], text) is
  'Creates a named plan as a draft, addresses it to the circle''s active members, and moves it to collecting through the state machine. Defaults are resolved by the domain before it is called.';

revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], text) from public;
revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], text) from anon, authenticated;
grant execute on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], text) to authenticated;

-- supabase/sql/functions/public/join_from_plan.sql
-- ---------------------------------------------------------------------------
-- join_from_plan
--
-- Joining a circle from the link the group chat actually sees (ADR 0022).
--
-- The message an organiser pastes carries only the plan's link, `/j/<code>`.
-- Until ADR 0022 that link was a dead end for anybody new: the circle's invite
-- secret was the only thing that could create a membership, and a plan link
-- does not carry it. Now **the plan's short code admits, while the plan is
-- taking answers**, and joining through it makes the person one of the people
-- that plan is asking.
--
-- **What authorises it is the code and the plan's state, together.** Only a
-- plan in `collecting` or `ready` whose response deadline is still ahead, in an
-- active circle — the domain's `acceptsAnswers`, and the same two conditions
-- `replace_response` checks. A quiet ask still `seeking`, a confirmed plan, a
-- finished, expired or cancelled one, and a code that does not exist all get
-- one answer, `invite_inactive`. That is the whole of the promise: **a refusal
-- does not say why.** It does not hide that a plan is taking answers — a join
-- that succeeds says so — and `preview_for_code` already names the circle
-- behind any code; what it must not add is a way to tell a quiet ask from a
-- cancelled plan by how the door is shut.
--
-- The code is weak on purpose (ADR 0022's consequences): eight characters,
-- in URL paths, not revocable, bounded by the deadline. What makes that
-- acceptable is that guessing is slow — Turnstile, and limits per code and per
-- address — and those live in the `join-plan` Edge Function, because only it
-- can see a Turnstile token or the caller's address.
--
-- **So this is the service role's, and the person joining is a parameter.**
-- `redeem_invite` is granted to `authenticated` and acts on `auth.uid()`, and
-- it can be: its secret is 256 bits, so a client calling the RPC directly and
-- skipping the function's limits gains volume and nothing else. Here the same
-- grant was the hole. Any session, an anonymous one included, could call
-- `/rest/v1/rpc/join_from_plan` as often as it liked, and every guess that
-- landed was a seat in somebody's circle. Taking the grant away makes the Edge
-- Function the only way in, which is `claim_identity`'s shape for the same
-- reason: the proof the database cannot check is checked before it is called.
-- The id comes from the caller's verified JWT (`actor.userId`), never from the
-- request body.
--
-- **Already a member.** No name is read. The person is added to the plan's
-- current revision if they are not on it, which is spec §9's "new members may
-- opt into the active plan": somebody who joined through the invite while this
-- plan was running was never asked, and opening its link asks them. No
-- membership is written, so no join is announced.
--
-- **A new member** is admitted by `private.admit_member`, under the circle's
-- lock — the cap, the name and rejoining after removal, exactly as an invite
-- does it — and added to the plan in the same transaction. A guest must give a
-- name. A saved place may leave it out and joins under their profile's name,
-- which names the membership in this circle and nothing else: after a
-- `duplicate_name` they pass one, and their profile is not touched.
--
-- **The quorum moves with the circle, while nobody has chosen it** (ADR 0026).
-- A plan made on the first run is made on a circle of one, seconds old, so its
-- quorum is a placeholder: `public.soft_quorum` of the active members, rewritten
-- on every join that admits somebody new, through `quorum_follows` — no new
-- revision, so every answer already given stands, and no event, because the
-- join itself was announced. A quorum the organiser set (`quorum_source` is
-- `chosen`) never moves here, and neither does one on a plan whose members are
-- leaving: a removal that lowered the quorum would make a plan `ready` as a
-- side effect of somebody leaving.
--
-- **The input version does**, when somebody is added to the plan. The roster is
-- engine input — `engine_input` reads `plan_participants`, and the set it
-- stores says "4 of 7" — so a set computed before the join is a set about a
-- different audience, which is what `on_member_removed` says for the opposite
-- move. The Edge Function recalculates in the same request (ADR 0018). A call
-- that adds nobody bumps nothing: an organiser looking at the set must not have
-- it replaced because somebody already on the plan opened its link again.
--
-- Returns the circle, the plan's id, and whether this call added the caller to
-- the plan — the last so the Edge Function recalculates only when something
-- changed.
-- ---------------------------------------------------------------------------

create or replace function public.join_from_plan(
  -- Who is joining: the verified caller, as `join-plan` resolved them.
  p_user_id uuid,
  p_short_code text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := p_user_id;
  found_plan_id uuid;
  plan public.plans;
  target public.circles;
  chosen_name text := p_display_name;
  added integer;
  members integer;
  following integer;
  quorum_moved boolean := false;
  restaled boolean := false;
begin
  if caller is null then
    raise exception 'join_from_plan requires the person joining'
      using errcode = 'insufficient_privilege';
  end if;

  -- Shape first, as `preview_for_code` does: rubbish never reaches the tables.
  -- The short-code alphabet has no `i`, `l`, `o`, `0` or `1` in it.
  if p_short_code is null or p_short_code !~ '^[a-hjkmnp-z2-9]{6,12}$' then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  select p.id into found_plan_id from public.plans p where p.short_code = p_short_code;
  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- Circle before plan, the order `create_plan` and `on_member_removed` take
  -- the same two locks in; transactions that lock in one order cannot deadlock
  -- over them. The circle's lock serialises joins, which is what the cap and
  -- the name check depend on. The plan's holds it in the state it is judged in
  -- below: a confirm or a cancel committing between the check and the insert
  -- would otherwise add somebody to a plan that was no longer asking.
  select c.* into target
  from public.circles c
  join public.plans p on p.circle_id = c.id
  where p.id = found_plan_id
  for update of c;

  select * into plan from public.plans p where p.id = found_plan_id for update;

  -- One answer for every way a plan is not admitting. The detail stays out of
  -- the message on purpose: `_shared/problem.ts` maps the message, and the
  -- message is what the caller sees.
  if target.status <> 'active'
    or plan.state not in ('collecting', 'ready')
    or now() >= plan.response_deadline
  then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target.id and m.user_id = caller and m.status = 'active'
  ) then
    -- A saved place's profile name, when they gave none. Read from
    -- `auth.users` rather than the JWT claim, which `reattach_member` explains:
    -- a token issued minutes before somebody saved their place still says
    -- `is_anonymous: true`.
    if chosen_name is null and exists (
      select 1 from auth.users u where u.id = caller and not coalesce(u.is_anonymous, true)
    ) then
      select pr.display_name into chosen_name from public.profiles pr where pr.user_id = caller;
    end if;

    if chosen_name is null then
      raise exception 'display_name_unusable' using errcode = 'check_violation';
    end if;

    perform private.admit_member(target.id, caller, chosen_name);
  end if;

  insert into public.plan_participants (plan_id, revision, user_id)
  values (plan.id, plan.revision, caller)
  on conflict do nothing;
  get diagnostics added = row_count;

  if added > 0 then
    update public.plans p
    set input_version = p.input_version + 1
    where p.id = plan.id;

    -- Architecture §8.3's `ready ─(response change)─▶ collecting`, for the same
    -- reason `replace_response` and `revise_plan` fire it: a ready plan whose
    -- input just moved has no current candidate set. `join-plan` recalculates
    -- straight after and tolerates that failing (ADR 0018), and a plan left
    -- `ready` meanwhile is one every screen and job reads as confirmable while
    -- `confirm` refuses its set as stale. The recalculation brings it back.
    -- `candidates_gone` has no guard and announces nothing.
    if plan.state = 'ready' then
      perform planning.transition_plan(plan.id, 'candidates_gone', caller);
      restaled := true;
    end if;
  end if;

  -- A quorum nobody chose, on the audience this join just changed.
  --
  -- Keyed on the *participant* row, not on the membership: a member of the
  -- circle who opens the plan for the first time is somebody the plan is now
  -- asking, and no membership is written for them (review round 3).
  if added > 0 then
    -- The count *after* the admission, and of the people this plan is actually
    -- asking — its participants at this revision — rather than the circle's
    -- roster.
    --
    -- Two things follow, and both are the point (review round 2). A member who
    -- joined by the circle's invite and never opened this plan was never asked
    -- (spec §9 makes joining an active plan an opt-in), so they must not raise
    -- the number of people who have to make it — a quorum above the people who
    -- can answer is a plan that can never reach it. And a circle's *other*
    -- defaulted plans are left alone, because their own audiences did not
    -- change; the rule follows the question, not the address book.
    select count(*) into members
    from public.plan_participants pp
    join public.circle_members m
      on m.circle_id = target.id and m.user_id = pp.user_id and m.status = 'active'
    where pp.plan_id = plan.id and pp.revision = plan.revision;

    -- Never below where it already is. The rule follows a circle that is
    -- growing; a circle that shrank keeps its number, because a removal must
    -- not lower a quorum as a side effect (ADR 0026) and the next join would
    -- otherwise do it on the removal's behalf — possibly making the plan
    -- `ready` on the way (review round 4). Lowering is the organiser's, and
    -- doing it makes the number theirs.
    following := greatest(plan.quorum, public.soft_quorum(members));
    if plan.quorum_source = 'defaulted' and following is distinct from plan.quorum then
      -- The plan's own rule writing, under the lock this function already
      -- holds. `transition_plan` bumps the input version for a quorum change
      -- and leaves the revision alone (ADR 0017), so the candidate set is
      -- restaled and the answers are kept.
      perform planning.transition_plan(
        plan.id, 'quorum_follows', caller, jsonb_build_object('quorum', following)
      );
      quorum_moved := true;
    end if;
  end if;

  -- A `ready` plan whose quorum just moved must not stay `ready`: a candidate
  -- set is eligible on its versions and never reads the quorum, so a
  -- four-person option would stay confirmable under a quorum of five. Once is
  -- enough — the roster change above may have said it already.
  if quorum_moved and plan.state = 'ready' and not restaled then
    perform planning.transition_plan(plan.id, 'candidates_gone', caller);
  end if;

  return jsonb_build_object(
    'circle', to_jsonb(target),
    'plan_id', plan.id,
    'newly_asked', added > 0
  );
end;
$$;

comment on function public.join_from_plan(uuid, text, text) is
  'Joins a person to the circle behind a plan short code while that plan is taking answers, and adds them to its current revision (ADR 0022). Idempotent; moves a quorum nobody chose to soft_quorum of the new member count (ADR 0026). Raises invite_inactive for every plan that is not admitting, or duplicate_name, display_name_unusable, circle_full. Service role only: Turnstile and the rate limits that make a short code acceptable are in the join-plan Edge Function, and a client calling this directly would skip them.';

revoke all on function public.join_from_plan(uuid, text, text) from public;
revoke all on function public.join_from_plan(uuid, text, text) from anon, authenticated;
grant execute on function public.join_from_plan(uuid, text, text) to service_role;

-- supabase/sql/functions/public/soft_quorum.sql
-- The quorum a plan carries while nobody has chosen one (ADR 0026).
--
-- `max(3, quorum_default(n))`, where `quorum_default` is `max(2, ceil(n × 0.6))`
-- — the same rule as `quorumDefault` in `packages/domain/src/circles/quorum.ts`,
-- and this copy is the authoritative one: it is a transition guard, so it lives
-- in both places by design (AGENTS.md, architecture §6.4), and `100_plan_lifecycle`
-- walks the same counts the domain's unit test does.
--
-- The floor is why this is not just `quorum_default`. First run makes a plan on
-- a circle of **one** and shares the plan's link rather than an invite, so the
-- count at creation is the organiser alone. `quorum_default(1)` and
-- `quorum_default(2)` are both 2, so without the floor the first friend to
-- answer would take the plan to `ready` and the organiser would be shown a best
-- time for two people while the rest of the chat was still reading the message.
-- Three is `member_cap`'s sibling: the count at which "most of us" stops
-- meaning "both of us".
--
-- 1→3, 3→3, 5→3, 6→4, 8→5, 12→8.
create or replace function public.soft_quorum(active_member_count integer)
returns integer
language sql
immutable
as $$
  select greatest(3, greatest(2, ceil(coalesce(active_member_count, 0) * 0.6)::integer));
$$;

comment on function public.soft_quorum(integer) is
  'The quorum a plan carries while its quorum_source is defaulted: max(3, the 60% default). Mirrors softQuorum in @circles/domain (ADR 0026).';

revoke all on function public.soft_quorum(integer) from public;
revoke all on function public.soft_quorum(integer) from anon, authenticated;

-- END GENERATED: function definitions
