-- ---------------------------------------------------------------------------
-- 0035 — The organiser sets the final plan (SUS-138, ADR 0050).
--
-- The organiser can lock in any day and time, not only an option, and edit a
-- locked-in plan's time, place and note without asking everyone again. The
-- override is never silent: before anything is locked in the organiser sees by
-- name who it works for (`public.stretch_availability`), and the confirmation
-- records that it was the organiser's own and whether it was below the plan's
-- number.
--
--   * `meetup_confirmations` gains `own_time`, `below_quorum`,
--     `moved_from_starts_at` / `moved_from_ends_at` (where a move came from),
--     and `calendar_uid` / `calendar_sequence` (one calendar entry across moves:
--     same UID, higher sequence). `calendar_uid` is backfilled with the id, which
--     is what every `.ics` already downloaded carries as its UID. A move
--     supersedes for the new reason `move`, in the same revision.
--   * `planning.transitions` is reseeded from the domain: `confirm_own` from
--     `collecting` and `ready`, and `move_confirmed` and `edit_confirmed` from
--     `confirmed`.
--   * `confirmation.meetup_moved` joins the event catalogue; `moved` joins the
--     notification kinds.
--   * Functions: `public.stretch_availability`, `public.confirm_own_time` and
--     `public.edit_confirmation` (new), `private.stretch_availability`,
--     `private.own_time_problem` and `private.apply_organiser_plan` (new);
--     `planning.transition_plan`, `planning.allowed_keys`, `planning.event_for`
--     and `public.dispatch_cancel_pending` (the new actions and kind).
--
-- `MIGRATION` in `scripts/gen-sql-functions.mjs`, `scripts/gen-transitions.mjs`
-- and `scripts/gen-events.mjs` now points here.
-- ---------------------------------------------------------------------------

alter table public.meetup_confirmations
  add column own_time boolean not null default false,
  add column below_quorum boolean not null default false,
  add column moved_from_starts_at timestamptz,
  add column moved_from_ends_at timestamptz,
  add column calendar_uid uuid,
  add column calendar_sequence integer not null default 0;

-- Every confirmation so far keeps the UID its calendar file already carried.
update public.meetup_confirmations set calendar_uid = id;

alter table public.meetup_confirmations
  alter column calendar_uid set not null,
  alter column calendar_uid set default gen_random_uuid();

comment on column public.meetup_confirmations.own_time is
  'The time was the organiser''s own, not one of the engine''s options (ADR 0050). It decides who starts out going: everybody a candidate did not cover is to confirm, never can''t make it.';
comment on column public.meetup_confirmations.below_quorum is
  'An own time with fewer people able to make it than the plan''s number, as it was when locked in. The plan''s number is not changed by it (ADR 0050).';
comment on column public.meetup_confirmations.moved_from_starts_at is
  'On the confirmation a move wrote: the start the plan had before it moved, so "moved from Fri 18" is a fact about this row (ADR 0050).';
comment on column public.meetup_confirmations.calendar_uid is
  'The calendar entry''s UID, kept across a move so a calendar moves its entry rather than adding a second; calendar_sequence rises with each move (RFC 5545).';

alter table public.meetup_confirmations
  add constraint meetup_confirmations_below_quorum_is_own check (own_time or not below_quorum),
  add constraint meetup_confirmations_moved_from_shape check (
    (moved_from_starts_at is null) = (moved_from_ends_at is null)
    and (moved_from_starts_at is null or (own_time and moved_from_ends_at > moved_from_starts_at))
  ),
  add constraint meetup_confirmations_calendar_sequence check (calendar_sequence >= 0);

-- A move is a new reason a confirmation stops being active, beside `reopen`,
-- `cancel` and `outcome`. A `case`, as before, so a null cannot pass.
alter table public.meetup_confirmations
  drop constraint meetup_confirmations_superseded_shape,
  add constraint meetup_confirmations_superseded_shape check (
    case status
      when 'active' then superseded_at is null and superseded_reason is null
      else superseded_at is not null and superseded_reason in ('reopen', 'cancel', 'outcome', 'move')
    end
  );

alter table jobs.notification_jobs
  drop constraint notification_jobs_kind,
  add constraint notification_jobs_kind check (kind in (
    'new_plan', 'quiet_ask', 'threshold_initiator', 'threshold_keen', 'deadline_approaching',
    'options_ready', 'replies_closed', 'locked_in', 'changed', 'cancelled', 'reminder',
    'did_it_happen', 'about_time', 'did_it_happen_participant', 'verify_email',
    'quiet_expired', 'asked_again', 'moved'
  ));

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
    'growth.account_claimed'
-- END GENERATED: event names
));

delete from planning.transitions;

-- BEGIN GENERATED: transitions (scripts/gen-transitions.mjs)
insert into planning.transitions (from_state, action, to_state, guards, bumps_revision) values
  ('draft', 'create_named', 'collecting', array['member','permanent','no_open_plan'], false),
  ('draft', 'create_quiet', 'seeking', array['member','permanent','no_open_plan'], false),
  ('seeking', 'threshold_reached', 'collecting', array['threshold','no_open_plan'], false),
  ('seeking', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'accept_organiser', 'collecting', array['member','permanent','no_organiser_yet','keen_initiator_or_owner'], false),
  ('ready', 'accept_organiser', 'ready', array['member','permanent','no_organiser_yet','keen_initiator_or_owner'], false),
  ('seeking', 'cancel', 'cancelled', array['member','initiator'], false),
  ('collecting', 'candidates_ready', 'ready', array[]::text[], false),
  ('collecting', 'edit', 'collecting', array['organiser'], true),
  ('collecting', 'adjust', 'collecting', array['organiser'], false),
  ('collecting', 'narrow', 'collecting', array['organiser'], false),
  ('collecting', 'quorum_follows', 'collecting', array[]::text[], false),
  ('collecting', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'adjust', 'ready', array['organiser'], false),
  ('ready', 'narrow', 'ready', array['organiser'], false),
  ('ready', 'quorum_follows', 'ready', array[]::text[], false),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('collecting', 'confirm_own', 'confirmed', array['organiser','own_time'], false),
  ('ready', 'confirm_own', 'confirmed', array['organiser','own_time'], false),
  ('collecting', 'hand_off', 'collecting', array['organiser','hand_off_target'], false),
  ('ready', 'hand_off', 'ready', array['organiser','hand_off_target'], false),
  ('ready', 'expire', 'expired', array[]::text[], false),
  ('ready', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'reopen', 'collecting', array['organiser','no_open_plan'], true),
  ('confirmed', 'move_confirmed', 'confirmed', array['organiser','own_time'], false),
  ('confirmed', 'edit_confirmed', 'confirmed', array['organiser'], false),
  ('confirmed', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'report_outcome', 'completed', array['organiser'], false);
-- END GENERATED: transitions

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
    -- Days taken away that nobody picked (ADR 0047): the window's ends may
    -- move inward, and the two keys an adjustment takes may ride along. Never
    -- the band or the duration, which are always a new question.
    -- `revise_plan` derives it; no caller names it.
    when action = 'narrow' then array['window_start', 'window_end', 'quorum', 'response_deadline']
    -- The quorum alone. `quorum_follows` is the circle moving a quorum nobody
    -- chose (ADR 0026); a deadline riding along on it would be a change no
    -- organiser asked for and nobody announced.
    when action = 'quorum_follows' then array['quorum']
    when action in ('edit', 'reopen') then array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local',
      'duration_minutes', 'quorum', 'response_deadline'
    ]
    when action = 'cancel' then array['cancel_note']
    -- A quiet ask opening is asked for times from that moment, so its deadline
    -- is set then: `defaultDeadline` for its window as of *now*, not as of when
    -- it was asked (`onThreshold`, spec §5.4.5). The only key it takes.
    when action = 'threshold_reached' then array['response_deadline']
    -- Who takes the plan over, and nothing else: a hand-off changes who
    -- decides, not what is being decided (S2-05).
    when action = 'hand_off' then array['organiser_user_id']
    when action = 'confirm' then array['candidate_id', 'place_name', 'place_url', 'note', 'chased_answer']
    -- The organiser's own time and edits to it (ADR 0050). The stretch is two
    -- instants; `edit_confirmed` and a move say the place and note whole, a
    -- present key with a null clearing it.
    when action = 'confirm_own' then array[
      'starts_at', 'ends_at', 'place_name', 'place_url', 'note', 'chased_answer'
    ]
    when action = 'move_confirmed' then array[
      'starts_at', 'ends_at', 'place_name', 'place_url', 'note'
    ]
    when action = 'edit_confirmed' then array['place_name', 'place_url', 'note']
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
    -- Not `organiser_accepted`: nobody accepted anything. The organiser gave
    -- the plan to somebody, and the drain tells the new one it is theirs.
    when 'hand_off' then 'planning.organiser_changed'
    when 'edit' then 'planning.plan_revised'
    -- The same event. What the circle is told is "the plan changed"; that this
    -- change cost nobody a second reply is the *absence* of a re-ask, which the
    -- notification rules read from the revision rather than from the name.
    when 'adjust' then 'planning.plan_revised'
    -- And a narrowing (ADR 0047): the plan's days changed, nobody's answer did.
    when 'narrow' then 'planning.plan_revised'
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
    -- An organiser's own time is the same news as an option locked in
    -- (ADR 0050): "locked in", to the same people.
    when 'confirm_own' then 'confirmation.meetup_confirmed'
    -- Moving a locked-in time without asking anybody again: its own letter,
    -- which `meetup_rescheduled` ("new times, please") must not be.
    when 'move_confirmed' then 'confirmation.meetup_moved'
    -- A place or note edit is not announced: `edit_confirmed` is null, and
    -- `transition_plan` names it among the silences beside `candidates_gone`.
    when 'edit_confirmed' then null
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
  problem text;
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
      when 'no_open_plan' then
        -- One open plan per circle (spec §5.3, ADR 0033): a second plan raised
        -- while one was `collecting` or `ready` left the first running — its
        -- link taking answers, its deadline closing, its emails sending — and
        -- circle home showing only the newest. On every row that enters
        -- `collecting` or `ready` from outside them: creation, a quiet ask
        -- crossing its threshold, a locked-in plan reopened (review round 1 —
        -- "Change the time" beside a newer plan made two). The circle row is
        -- locked first, so two arriving together are decided one after the
        -- other whoever the caller is; `create_plan` already holds this lock,
        -- and a re-lock in the same transaction is free. The plan moving is
        -- excluded by id, so a draft, a seeking ask or a confirmed plan is not
        -- counted against itself.
        perform 1 from public.circles c where c.id = plan.circle_id for update;
        if exists (
          select 1 from public.plans p
          where p.circle_id = plan.circle_id
            and p.id <> plan.id
            and p.state in ('collecting', 'ready')
        ) then
          raise exception 'plan_in_progress' using errcode = 'P0001';
        end if;
      when 'hand_off_target' then
        -- "Hand this to someone else" (spec §5.7, §9), the receiving half; the
        -- giving half is the `organiser` guard before it. The same refusals as
        -- `handOffRefusal` in the domain, in the same order: the plan is theirs
        -- already, they are not in the circle, the plan is not asking them, or
        -- they have no saved place — "organiser roles belong to saved-place
        -- identities only" (spec §8.2), which is the invariant this guard
        -- exists to hold.
        if (p_payload ->> 'organiser_user_id')::uuid is not distinct from plan.organiser_user_id then
          raise exception 'already_the_organiser' using errcode = 'P0001';
        end if;
        if not exists (
          select 1 from public.circle_members m
          where m.circle_id = plan.circle_id
            and m.user_id = (p_payload ->> 'organiser_user_id')::uuid
            and m.status = 'active'
        ) then
          raise exception 'not_a_member' using errcode = 'P0001';
        end if;
        -- One of the people this revision asks: the organiser's letters go to
        -- the plan's own audience, so somebody outside it would organise a plan
        -- that could never write to them.
        if not exists (
          select 1 from public.plan_participants pp
          where pp.plan_id = plan.id and pp.revision = plan.revision
            and pp.user_id = (p_payload ->> 'organiser_user_id')::uuid
        ) then
          raise exception 'not_a_participant' using errcode = 'P0001';
        end if;
        if not coalesce((
          select p.is_permanent from public.profiles p
          where p.user_id = (p_payload ->> 'organiser_user_id')::uuid
        ), false) then
          raise exception 'requires_saved_place' using errcode = 'P0001';
        end if;
      when 'own_time' then
        -- The organiser's own time (ADR 0050): not an option, so the guard is the
        -- stretch being a valid one. `ownTimeProblem` in the domain, which names
        -- the same codes in the same order; a stretch nobody named is
        -- `needs_own_time`.
        problem := private.own_time_problem(
          plan,
          (p_payload ->> 'starts_at')::timestamptz,
          (p_payload ->> 'ends_at')::timestamptz
        );
        if problem is not null then
          raise exception '%', problem using errcode = 'P0001';
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
      -- The person the guard above has just approved, never the actor.
      when p_action = 'hand_off' then (p_payload ->> 'organiser_user_id')::uuid
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

  -- The organiser setting the final plan (ADR 0050): an own time, a move, or a
  -- place and note edit. The confirmation is written in here for the reason
  -- `confirm`'s is: no moment at which a plan is `confirmed` with nothing
  -- confirmed, and no event about a confirmation a later insert might fail to
  -- create. `private.apply_organiser_plan` is the whole of it.
  if p_action in ('confirm_own', 'move_confirmed', 'edit_confirmed') then
    confirmation_id := private.apply_organiser_plan(plan, p_action, p_actor, p_payload);
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
      p_action in ('candidates_gone', 'quorum_follows', 'edit_confirmed')
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
  -- Which of the organiser's own times it was, and no more: the times are on the
  -- confirmation, and the payload carries ids and flags only (§6.3).
  if p_action in ('confirm_own', 'move_confirmed') then
    event_payload := event_payload || jsonb_build_object('own_time', true);
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

-- supabase/sql/functions/private/apply_organiser_plan.sql
-- ---------------------------------------------------------------------------
-- What the organiser setting the final plan does to the confirmation
-- (ADR 0050), in the transaction `planning.transition_plan` has already opened
-- under the plan's row lock.
--
--   * `confirm_own` writes the first confirmation, for a stretch that is not in
--     any candidate set: `own_time`, and `below_quorum` when fewer can make it
--     than the plan asked for. Nothing about the plan's number moves.
--   * `move_confirmed` supersedes the active confirmation for the reason `move`
--     and writes a new active one in the **same revision**, so "Friday was moved"
--     stays true in the record and a revision still has at most one active
--     confirmation. The new row says where it moved from, keeps the calendar
--     entry's identity with a higher sequence, and carries the old row's survey
--     answer: that question is asked once per plan, at the first lock-in.
--   * `edit_confirmed` updates the place and note of the active row in place.
--     Nobody's status changes and nothing is written beside it.
--
-- **Who is going** is `deriveAttendance` for an own time: going for anybody whose
-- times cover the stretch or who said "I'm easy" (`private.stretch_availability`,
-- the same rule the picker showed), and everybody else *to confirm*, whether
-- they answered or not. Never "can't make it": they never said no to a time the
-- organiser chose knowing the answers (manifesto §3.5). A move derives it again
-- from this revision's answers, and the old rows stay as history, so a status
-- somebody set by hand for the old time does not carry over.
--
-- Returns the id of the active confirmation.
-- ---------------------------------------------------------------------------

create or replace function private.apply_organiser_plan(
  p_plan public.plans,
  p_action text,
  p_actor uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts timestamptz := (p_payload ->> 'starts_at')::timestamptz;
  ends timestamptz := (p_payload ->> 'ends_at')::timestamptz;
  old public.meetup_confirmations;
  stretch jsonb;
  available uuid[];
  confirmation_id uuid;
begin
  if p_action = 'edit_confirmed' then
    select * into old from public.meetup_confirmations c
    where c.plan_id = p_plan.id and c.revision = p_plan.revision and c.status = 'active'
    for update;
    if not found then
      raise exception 'confirmation_not_active' using errcode = 'P0001';
    end if;
    if old.ends_at <= now() then
      raise exception 'meetup_has_ended' using errcode = 'P0001';
    end if;

    update public.meetup_confirmations c
    set place_name = case when p_payload ? 'place_name' then p_payload ->> 'place_name' else c.place_name end,
        place_url = case when p_payload ? 'place_url' then p_payload ->> 'place_url' else c.place_url end,
        note = case when p_payload ? 'note' then p_payload ->> 'note' else c.note end
    where c.id = old.id;
    return old.id;
  end if;

  stretch := private.stretch_availability(p_plan.id, starts, ends);
  available := coalesce(
    (select array_agg(e::uuid order by o)
     from jsonb_array_elements_text(stretch -> 'available') with ordinality as t (e, o)),
    array[]::uuid[]
  );

  if p_action = 'confirm_own' then
    insert into public.meetup_confirmations (
      plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids,
      place_name, place_url, note, chased_answer, confirmed_by, own_time, below_quorum
    ) values (
      p_plan.id, p_plan.revision,
      to_char(starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      starts, ends, available,
      p_payload ->> 'place_name', p_payload ->> 'place_url', p_payload ->> 'note',
      p_payload ->> 'chased_answer', p_actor,
      true, cardinality(available) < p_plan.quorum
    ) returning id into confirmation_id;
  else
    select * into old from public.meetup_confirmations c
    where c.plan_id = p_plan.id and c.revision = p_plan.revision and c.status = 'active'
    for update;
    if not found then
      raise exception 'confirmation_not_active' using errcode = 'P0001';
    end if;
    if old.ends_at <= now() then
      raise exception 'meetup_has_ended' using errcode = 'P0001';
    end if;

    update public.meetup_confirmations c
    set status = 'superseded', superseded_at = now(), superseded_reason = 'move'
    where c.id = old.id;

    insert into public.meetup_confirmations (
      plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids,
      place_name, place_url, note, chased_answer, confirmed_by, own_time, below_quorum,
      moved_from_starts_at, moved_from_ends_at, calendar_uid, calendar_sequence
    ) values (
      p_plan.id, p_plan.revision,
      to_char(starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      starts, ends, available,
      case when p_payload ? 'place_name' then p_payload ->> 'place_name' else old.place_name end,
      case when p_payload ? 'place_url' then p_payload ->> 'place_url' else old.place_url end,
      case when p_payload ? 'note' then p_payload ->> 'note' else old.note end,
      old.chased_answer, p_actor,
      true, cardinality(available) < p_plan.quorum,
      old.starts_at, old.ends_at, old.calendar_uid, old.calendar_sequence + 1
    ) returning id into confirmation_id;
  end if;

  -- `deriveAttendance` for an own time. Derived, not said: the marker keeps the
  -- attendance trigger from announcing the organiser's own row as a fresh answer.
  perform set_config('circles.deriving_attendance', 'on', true);
  insert into public.attendance (confirmation_id, user_id, status)
  select confirmation_id, pp.user_id,
    case when pp.user_id = any (available) then 'going' else 'unknown' end
  from public.plan_participants pp
  join public.circle_members m
    on m.circle_id = p_plan.circle_id and m.user_id = pp.user_id and m.status = 'active'
  where pp.plan_id = p_plan.id and pp.revision = p_plan.revision;
  perform set_config('circles.deriving_attendance', 'off', true);

  return confirmation_id;
end;
$$;

comment on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) is
  'The confirmation side of the organiser setting the final plan: an own time, a move (supersede and write a new active confirmation in the same revision) or a place and note edit in place. Called by transition_plan under the plan''s lock (ADR 0050).';

revoke all on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) from public;
revoke all on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) from anon, authenticated;
grant execute on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) to service_role;

-- supabase/sql/functions/private/own_time_problem.sql
-- ---------------------------------------------------------------------------
-- What is wrong with a stretch the organiser wants to lock in, if anything
-- (ADR 0050).
--
-- `ownTimeProblem` in `packages/domain`, rule for rule and in the same order:
-- shape before the clock, so a stretch that is off the half hour is wrong
-- whenever it is. Returns the refusal code, or null when it is a valid own
-- time. The codes are the domain's, so a client can tell somebody what was
-- wrong, and the database refuses what the screen should never have sent.
--
--   * both ends on a half hour on the plan's clock, with no seconds;
--   * it ends after it starts, and lasts from 30 minutes to 5 hours;
--   * it starts in the future;
--   * it starts no later than the plan's last day plus thirty, on the plan's
--     clock rather than UTC.
-- ---------------------------------------------------------------------------

create or replace function private.own_time_problem(
  p_plan public.plans,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  minutes numeric;
begin
  if p_starts_at is null or p_ends_at is null then
    return 'needs_own_time';
  end if;

  if extract(second from (p_starts_at at time zone p_plan.time_zone)) <> 0
     or extract(second from (p_ends_at at time zone p_plan.time_zone)) <> 0
     or extract(minute from (p_starts_at at time zone p_plan.time_zone))::integer % 30 <> 0
     or extract(minute from (p_ends_at at time zone p_plan.time_zone))::integer % 30 <> 0 then
    return 'own_time_off_the_half_hour';
  end if;

  if p_ends_at <= p_starts_at then
    return 'own_time_ends_before_it_starts';
  end if;

  minutes := extract(epoch from (p_ends_at - p_starts_at)) / 60;
  if minutes < 30 then
    return 'own_time_too_short';
  end if;
  if minutes > 300 then
    return 'own_time_too_long';
  end if;

  if p_starts_at <= now() then
    return 'own_time_in_the_past';
  end if;

  if (p_starts_at at time zone p_plan.time_zone)::date > p_plan.window_end + 30 then
    return 'own_time_too_far_ahead';
  end if;

  return null;
end;
$$;

comment on function private.own_time_problem(public.plans, timestamptz, timestamptz) is
  'The first thing wrong with a stretch the organiser wants to lock in, as ownTimeProblem has it in the domain, or null (ADR 0050).';

revoke all on function private.own_time_problem(public.plans, timestamptz, timestamptz) from public;
revoke all on function private.own_time_problem(public.plans, timestamptz, timestamptz) from anon, authenticated;
grant execute on function private.own_time_problem(public.plans, timestamptz, timestamptz) to service_role;

-- supabase/sql/functions/private/stretch_availability.sql
-- ---------------------------------------------------------------------------
-- Who can make a stretch of time (ADR 0050).
--
-- `whoCanMake` in `packages/domain`, which the engine itself calls for every
-- start it enumerates: a member whose willing windows fully contain the stretch,
-- or who said "I'm easy", can make it. Everybody the plan is asking who answered
-- otherwise cannot, and somebody who has not answered is a third group, never
-- "cannot" — the screens say "Alex hasn't answered", not "doesn't work for Alex"
-- (manifesto §3.5).
--
-- The roster and the order are `engine_input`'s: the people the current
-- revision was asked of who are still active members, by when they joined and
-- then by id, so every list here is in the order the engine reports. Only
-- answers to the plan's current revision count.
--
-- Returns user ids and nothing else: no window, no status. The organiser reads
-- it through `public.stretch_availability`, and the confirmation freezes it.
-- ---------------------------------------------------------------------------

create or replace function private.stretch_availability(
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select p.id, p.circle_id, p.revision from public.plans p where p.id = p_plan_id
  ),
  roster as (
    select pp.user_id, pp.joined_at
    from plan
    join public.plan_participants pp on pp.plan_id = plan.id and pp.revision = plan.revision
    join public.circle_members m
      on m.circle_id = plan.circle_id and m.user_id = pp.user_id and m.status = 'active'
  ),
  verdict as (
    select
      ro.user_id,
      ro.joined_at,
      case
        when r.id is null then 'awaiting'
        when r.status = 'flexible' then 'available'
        when r.status = 'windows' and exists (
          select 1 from public.willing_windows w
          where w.response_id = r.id and w.starts_at <= p_starts_at and w.ends_at >= p_ends_at
        ) then 'available'
        else 'cannot'
      end as verdict
    from roster ro
    cross join plan
    left join public.plan_responses r
      on r.plan_id = plan.id and r.revision = plan.revision and r.user_id = ro.user_id
  )
  select jsonb_build_object(
    'available', coalesce(jsonb_agg(v.user_id order by v.joined_at, v.user_id)
      filter (where v.verdict = 'available'), '[]'::jsonb),
    'cannot', coalesce(jsonb_agg(v.user_id order by v.joined_at, v.user_id)
      filter (where v.verdict = 'cannot'), '[]'::jsonb),
    'awaiting', coalesce(jsonb_agg(v.user_id order by v.joined_at, v.user_id)
      filter (where v.verdict = 'awaiting'), '[]'::jsonb)
  )
  from verdict v;
$$;

comment on function private.stretch_availability(uuid, timestamptz, timestamptz) is
  'Who of the people the plan is asking can make a stretch, who answered otherwise and who has not answered, as whoCanMake has it in the domain: windows that fully contain it, or "I''m easy". Ids only (ADR 0050).';

revoke all on function private.stretch_availability(uuid, timestamptz, timestamptz) from public;
revoke all on function private.stretch_availability(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function private.stretch_availability(uuid, timestamptz, timestamptz) to service_role;

-- supabase/sql/functions/public/confirm_own_time.sql
-- ---------------------------------------------------------------------------
-- Locking in a time the organiser chose themselves (ADR 0050).
--
-- A wrapper over `planning.transition_plan(plan, 'confirm_own', …)`, as
-- `confirm_meetup` is for an option, and for the same reasons: `planning` is not
-- reachable by a client, and the actor must be `auth.uid()` rather than an
-- argument. The machine does the rest under the plan's lock: the organiser
-- guard, the stretch being a valid one (`private.own_time_problem`), the frozen
-- confirmation, who is going, and `confirmation.meetup_confirmed`.
--
-- **Freezing only what the organiser saw.** A candidate lock-in names the set it
-- was looking at (`expected_set_id`, ADR 0018). An own time has no set, so it
-- names the plan's `input_version`, which every answer moves. If somebody
-- answered while the organiser was looking, the names on the screen are not the
-- names that would be frozen, and the request is refused as `stale_availability`
-- so the screen can update and ask again. Null first and on its own, for the
-- reason `confirm_meetup` has: a caller who names no version was not looking at
-- one.
--
-- The plan's own state is checked ahead of the version, so a cancelled plan says
-- so rather than saying its names are out of date.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_own_time(
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  -- The plan's input version as `stretch_availability` returned it with the
  -- names the organiser was shown.
  p_expected_input_version integer,
  -- "Did you have to chase anyone outside the app?" (spec §5.10), required as in
  -- `confirm_meetup`: this function is granted to `authenticated` too, and the
  -- evidence for H2 is not optional because of the door somebody came through.
  p_chased_answer text,
  p_place_name text default null,
  p_place_url text default null,
  p_note text default null
)
returns public.meetup_confirmations
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  confirmation public.meetup_confirmations;
begin
  if caller is null then
    raise exception 'confirm_own_time requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  -- Membership before anything that can be observed, and a non-member gets the
  -- answer a plan that is not there would get (see `confirm_meetup`).
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if p_chased_answer is null or p_chased_answer not in ('none', 'one', 'more') then
    raise exception 'chased_answer_required' using errcode = 'P0001';
  end if;

  if plan.state not in ('collecting', 'ready') then
    raise exception '%', case
      when plan.state in ('completed', 'expired', 'cancelled') then 'plan_is_finished'
      else 'wrong_state'
    end using errcode = 'P0001';
  end if;

  if p_expected_input_version is distinct from plan.input_version then
    raise exception 'stale_availability' using errcode = 'P0001';
  end if;

  perform planning.transition_plan(
    p_plan_id,
    'confirm_own',
    caller,
    jsonb_strip_nulls(jsonb_build_object(
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'place_name', p_place_name,
      'place_url', p_place_url,
      'note', p_note,
      'chased_answer', p_chased_answer
    ))
  );

  select * into confirmation
  from public.meetup_confirmations c
  where c.plan_id = plan.id and c.revision = plan.revision and c.status = 'active';

  return confirmation;
end;
$$;

comment on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) is
  'Locks in a time the calling organiser chose, through planning.transition_plan, and refuses it as stale_availability when an answer arrived since the names they were shown (ADR 0050).';

revoke all on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) from public;
revoke all on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) from anon, authenticated;
grant execute on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) to authenticated;

-- supabase/sql/functions/public/dispatch_cancel_pending.sql
-- ---------------------------------------------------------------------------
-- The evening is off, so the letters about it stop.
--
-- A confirmation schedules two messages into the future — the reminder two
-- hours before, and "did it happen?" the next morning — and cancelling or
-- rescheduling the meetup has to take them back. They are `scheduled` rows
-- with a `scheduled_for` days away; nothing else would ever look at them
-- again, and the first anyone would know is a reminder for a Thursday that was
-- called off on Tuesday.
--
-- Found by plan and revision rather than by confirmation id, because a job
-- does not carry one: a revision has at most one active confirmation (§8.2),
-- so (plan, revision) names it. A reopen bumps the revision, which is why the
-- caller passes the revision the superseded confirmation was on and not the
-- one the plan is on now.
--
-- `locked_in` is in the list for a case that is easy to miss: a transient
-- provider failure leaves it `scheduled` with a backoff of up to half an hour,
-- and a reopen inside that half hour would otherwise send "locked in" for an
-- evening that is off, followed by a second "locked in" for the new one.
--
-- `moved` is in it for the same reason, once the organiser can move a
-- locked-in time (ADR 0050): a second move inside the backoff of the first
-- would otherwise send "moved to Saturday" after the plan had moved on to
-- Sunday. A move supersedes the confirmation inside the same revision, so the
-- caller passes the revision the plan is still on.
--
-- `skipped`, not `failed`: nothing went wrong. The code says what happened.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_cancel_pending(p_plan_id uuid, p_revision integer)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with cancelled as (
    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'superseded', updated_at = now()
    where j.plan_id = p_plan_id
      and j.plan_revision = p_revision
      and j.status = 'scheduled'
      and j.kind in ('locked_in', 'moved', 'reminder', 'did_it_happen', 'did_it_happen_participant')
    returning 1
  )
  select count(*)::integer from cancelled;
$$;

comment on function public.dispatch_cancel_pending(uuid, integer) is
  'Skips the still-scheduled reminder and outcome jobs for one plan revision, when its confirmation is cancelled or superseded. Service role only (S1-20).';

revoke all on function public.dispatch_cancel_pending(uuid, integer) from public;
revoke all on function public.dispatch_cancel_pending(uuid, integer) from anon, authenticated;
grant execute on function public.dispatch_cancel_pending(uuid, integer) to service_role;

-- supabase/sql/functions/public/edit_confirmation.sql
-- ---------------------------------------------------------------------------
-- Editing a locked-in plan: its time, its place and its note (ADR 0050).
--
-- "Edit this plan" on the confirmed screen. Three things can change, and the
-- difference between them is the whole of the design:
--
--   * **The place or the note alone** updates the active confirmation in place
--     (`edit_confirmed`). Nobody's status changes, nobody is emailed, and
--     everyone sees it straight away.
--   * **The time** is a move (`move_confirmed`): the active confirmation is
--     superseded for the reason `move` and a new one is written in the same
--     revision. Who is going is derived again, the reminder and the calendar
--     entry follow the new time, and the plan's members are told once.
--   * Neither asks anybody to answer again: that is "Ask for new times" (the old
--     "Change the time", `reopen`), which opens a new revision and is not here.
--
-- The place and note are said **whole**: what the screen now shows, with a null
-- clearing one. A save that moves the time and changes the place is one move. A
-- save that changes nothing is refused as `nothing_changed`, so a repeated
-- request is not a second move.
--
-- A move names the plan's `input_version` the way `confirm_own_time` does, and
-- for the same reason; an edit that leaves the time alone does not need it,
-- because it freezes no names.
-- ---------------------------------------------------------------------------

create or replace function public.edit_confirmation(
  p_plan_id uuid,
  -- The new time, both ends, or neither to leave it where it is.
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_expected_input_version integer,
  p_place_name text default null,
  p_place_url text default null,
  p_note text default null
)
returns public.meetup_confirmations
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  active public.meetup_confirmations;
  moving boolean;
  details jsonb;
begin
  if caller is null then
    raise exception 'edit_confirmation requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if plan.state <> 'confirmed' then
    raise exception '%', case
      when plan.state in ('completed', 'expired', 'cancelled') then 'plan_is_finished'
      else 'wrong_state'
    end using errcode = 'P0001';
  end if;

  select * into active from public.meetup_confirmations c
  where c.plan_id = plan.id and c.revision = plan.revision and c.status = 'active';
  if not found then
    raise exception 'confirmation_not_active' using errcode = 'P0001';
  end if;

  -- Both ends or neither: half a stretch is not a time.
  if (p_starts_at is null) <> (p_ends_at is null) then
    raise exception 'needs_own_time' using errcode = 'P0001';
  end if;
  moving := p_starts_at is not null
    and (p_starts_at, p_ends_at) is distinct from (active.starts_at, active.ends_at);

  if not moving
     and p_place_name is not distinct from active.place_name
     and p_place_url is not distinct from active.place_url
     and p_note is not distinct from active.note then
    raise exception 'nothing_changed' using errcode = 'P0001';
  end if;

  -- Whole, with a null clearing: `jsonb_build_object` keeps the keys, which is
  -- what tells a cleared note from one nobody mentioned.
  details := jsonb_build_object(
    'place_name', p_place_name, 'place_url', p_place_url, 'note', p_note
  );

  if moving then
    if p_expected_input_version is distinct from plan.input_version then
      raise exception 'stale_availability' using errcode = 'P0001';
    end if;
    perform planning.transition_plan(
      p_plan_id, 'move_confirmed', caller,
      details || jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at)
    );
  else
    perform planning.transition_plan(p_plan_id, 'edit_confirmed', caller, details);
  end if;

  select * into active from public.meetup_confirmations c
  where c.plan_id = plan.id and c.revision = plan.revision and c.status = 'active';
  return active;
end;
$$;

comment on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) is
  'The calling organiser edits a locked-in plan: a new time is a move (supersede and write a new active confirmation, same revision), a place or note alone updates it in place. Nobody is asked again (ADR 0050).';

revoke all on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) from public;
revoke all on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) from anon, authenticated;
grant execute on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) to authenticated;

-- supabase/sql/functions/public/stretch_availability.sql
-- ---------------------------------------------------------------------------
-- Who a stretch of time works for, for the organiser choosing one
-- (ADR 0050).
--
-- The picker, the review screen and the edit screen say it by name before
-- anything is locked in: "You, Priya and Tom can make it · Doesn't work for Jess
-- or Sam · Alex hasn't answered". That is what the candidate cards already say
-- for the options, asked of any stretch. `private.stretch_availability` is the
-- rule, `whoCanMake` in the domain, and the freeze in `confirm_own_time` reads
-- the same function, so what the organiser sees is what would be frozen.
--
-- **The organiser alone**: a member who is not the organiser is told the plan has
-- an organiser who is not them, and a stranger is told the plan is not there,
-- as `confirm_meetup` does. It returns ids and the plan's `input_version` and
-- revision as they are now, which the confirmation later compares under the
-- lock (`stale_availability`): the answer is only as current as its version.
-- Never a window, never a status.
--
-- Open to any stretch, valid or not: it is a question, not an act, and the
-- act is refused for the same stretch by `private.own_time_problem`.
-- ---------------------------------------------------------------------------

create or replace function public.stretch_availability(
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
begin
  if caller is null then
    raise exception 'stretch_availability requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id;
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;
  -- Where an organiser may set a time, and look at one they have set.
  if plan.state not in ('collecting', 'ready', 'confirmed') then
    raise exception 'wrong_state' using errcode = 'P0001';
  end if;

  return private.stretch_availability(plan.id, p_starts_at, p_ends_at)
    || jsonb_build_object('input_version', plan.input_version, 'revision', plan.revision);
end;
$$;

comment on function public.stretch_availability(uuid, timestamptz, timestamptz) is
  'For the plan''s organiser: who of the people the plan is asking can make a stretch, who answered otherwise and who has not, with the plan''s input version and revision. Ids only (ADR 0050).';

revoke all on function public.stretch_availability(uuid, timestamptz, timestamptz) from public;
revoke all on function public.stretch_availability(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.stretch_availability(uuid, timestamptz, timestamptz) to authenticated;

-- END GENERATED: function definitions
