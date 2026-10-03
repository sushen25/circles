-- ---------------------------------------------------------------------------
-- 0035 — The organiser sets the final plan (SUS-138, ADR 0051).
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
--   * SUS-103, ADR 0049 decision 6 (the founder's decision of 3 October 2026): an
--     emailed re-entry link may take a place back from a saved account whose own
--     email is not the link's address. `email_action_tokens` gains `retired_at` and
--     `minted_for_user_id` (`retired_at` is set by `retire_reentry_links`, so a link spent by a claim can be told from
--     one that already moved a place); new `private.takeback_allowed` and
--     `private.hand_back_membership`; `reattach_member`, `reconcile_contacts` and
--     `retire_reentry_links` change. Those functions sit in this migration's
--     generated block, which renders every function, because `0033` shipped
--     with the branch before them.
--
-- `MIGRATION` in `scripts/gen-sql-functions.mjs`, `scripts/gen-transitions.mjs`
-- and `scripts/gen-events.mjs` now points here.
-- ---------------------------------------------------------------------------

alter table private.email_action_tokens add column retired_at timestamptz;

-- The identity a link was minted for. A plain column, no reference: the link's
-- membership follows the place by cascade, and this must keep saying who the link
-- was first for (`private.takeback_allowed`). Null for links minted before it.
alter table private.email_action_tokens add column minted_for_user_id uuid;

comment on column private.email_action_tokens.minted_for_user_id is
  'The identity the re-entry link was minted for, fixed at issue and never moved with the membership (ADR 0049, decision 6). Null for a link minted before the column existed, which can never take a place back.';

comment on column private.email_action_tokens.retired_at is
  'When `retire_reentry_links` spent the link because its membership became a saved account''s. Null for a link that is unspent or was spent by being used. Only a retired link may still take the place back (ADR 0049, decision 6).';

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
  'The time was the organiser''s own, not one of the engine''s options (ADR 0051). It decides who starts out going: everybody a candidate did not cover is to confirm, never can''t make it.';
comment on column public.meetup_confirmations.below_quorum is
  'An own time with fewer people able to make it than the plan''s number, as it was when locked in. The plan''s number is not changed by it (ADR 0051).';
comment on column public.meetup_confirmations.moved_from_starts_at is
  'On the confirmation a move wrote: the start the plan had before it moved, so "moved from Fri 18" is a fact about this row (ADR 0051).';
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

-- The confirmation a letter is about, for the five kinds that describe one evening
-- (`locked_in`, `moved`, `reminder` and the two morning-after letters). Null for
-- every other kind and for every job written before this. `dispatch_cancel_pending`
-- uses it to take back the letters of a confirmation a move has replaced and keep
-- those of the one it made, so a retried event does not skip its own jobs.
alter table jobs.notification_jobs
  add column confirmation_id uuid;

comment on column jobs.notification_jobs.confirmation_id is
  'The meetup_confirmations row a locked_in, moved, reminder or did_it_happen letter is about, or null (ADR 0051).';

-- A new argument is a new signature; the old one would sit beside it and make
-- every two-argument call ambiguous (0019's lesson).
drop function if exists public.dispatch_cancel_pending(uuid, integer);

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
    -- The organiser's own time and edits to it (ADR 0051). The stretch is two
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
    -- (ADR 0051): "locked in", to the same people.
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
        -- The organiser's own time (ADR 0051): not an option, so the guard is the
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

  -- The organiser setting the final plan (ADR 0051): an own time, a move, or a
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
  -- The confirmation this event is about. The drain writes its letters from the
  -- plan's confirmation *as it is when it runs*, and a plan locked in and moved
  -- (or moved twice) inside one tick has several events about one active
  -- confirmation: only the event that made it speaks, because a later one takes
  -- the earlier one's still-scheduled letters back and the same keys would then
  -- find them skipped (ADR 0051). An id, never a time or a place.
  if p_action in ('confirm', 'confirm_own', 'move_confirmed') then
    event_payload := event_payload || jsonb_build_object('confirmation_id', confirmation_id);
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
-- (ADR 0051), in the transaction `planning.transition_plan` has already opened
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
        note = case when p_payload ? 'note' then p_payload ->> 'note' else c.note end,
        -- The calendar entry's content changed (LOCATION, DESCRIPTION): a higher
        -- sequence is what tells a calendar to take the new file (RFC 5545).
        calendar_sequence = c.calendar_sequence + 1
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
  'The confirmation side of the organiser setting the final plan: an own time, a move (supersede and write a new active confirmation in the same revision) or a place and note edit in place. Called by transition_plan under the plan''s lock (ADR 0051).';

revoke all on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) from public;
revoke all on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) from anon, authenticated;
grant execute on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) to service_role;

-- supabase/sql/functions/private/hand_back_membership.sql
-- ---------------------------------------------------------------------------
-- Take one circle's membership back from a saved account (ADR 0049, decision 6).
--
-- `reattach_member` calls this after `private.takeback_allowed` has said yes. It
-- moves the membership the way every move does, through `move_membership`, with
-- three differences that exist because the holder is an account with a life
-- outside this circle:
--
--   * **Only this circle's membership moves.** `move_membership` is already scoped
--     to one circle; the account keeps its other circles, its sign-in and its
--     profile, and nothing about them is read or written here.
--   * **Only the link's address moves.** A guest-to-guest move carries every
--     address attached to the place, and here the holder's own sign-in address may
--     be among them. `reconcile_contacts` is told, through a transaction-local
--     setting, to move the one contact the link names and leave the rest, so the
--     account's address and consent are never handed to somebody else.
--   * **The holder's other links for this circle are deleted first.** A re-entry
--     link names a membership and a contact that must belong to that membership's
--     holder; links for the holder's other addresses would be left pointing at a
--     person who no longer holds the place. They are the holder's, and a link that
--     can no longer move anything is of no use to them.
-- ---------------------------------------------------------------------------

create or replace function private.hand_back_membership(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid,
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_hash bytea;
begin
  select k.email_hash into link_hash from private.email_contacts k where k.id = p_contact_id;
  if link_hash is null then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  delete from private.email_action_tokens t
  where t.purpose = 'reentry'
    and t.membership_circle_id = p_circle_id
    and t.membership_user_id = p_from
    and t.contact_id <> p_contact_id;

  perform set_config('circles.takeback_email_hash', encode(link_hash, 'hex'), true);
  perform private.move_membership(p_circle_id, p_from, p_to);
  perform set_config('circles.takeback_email_hash', '', true);
end;
$$;

comment on function private.hand_back_membership(uuid, uuid, uuid, uuid) is
  'Moves one circle membership from a saved account to a guest identity named by an emailed link: that circle only, only the link''s address, the account''s other links for it deleted.';

revoke all on function private.hand_back_membership(uuid, uuid, uuid, uuid) from public;
revoke all on function private.hand_back_membership(uuid, uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/private/own_time_problem.sql
-- ---------------------------------------------------------------------------
-- What is wrong with a stretch the organiser wants to lock in, if anything
-- (ADR 0051).
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
  'The first thing wrong with a stretch the organiser wants to lock in, as ownTimeProblem has it in the domain, or null (ADR 0051).';

revoke all on function private.own_time_problem(public.plans, timestamptz, timestamptz) from public;
revoke all on function private.own_time_problem(public.plans, timestamptz, timestamptz) from anon, authenticated;
grant execute on function private.own_time_problem(public.plans, timestamptz, timestamptz) to service_role;

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
          (user_id, email_normalized, status, verified_at, suppressed_at, suppression_reason)
        select p_to, ec.email_normalized, ec.status, ec.verified_at, ec.suppressed_at,
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

-- supabase/sql/functions/private/retire_reentry_links.sql
-- ---------------------------------------------------------------------------
-- A membership is about to belong to somebody with a saved place, so its
-- emailed way in without signing in has to stop being one.
--
-- `enforce_reentry_for_guests` refuses to *issue* a re-entry token against a
-- permanent identity, and the same rule has to hold when a membership becomes a
-- permanent identity's. Spent rather than deleted, so that following the link
-- still finds something and `reattach_member` can offer that identity's sign-in
-- (§10's third outcome) instead of calling the link broken.
--
-- Called from two places, and the reason is ordering rather than duplication:
--
--   * `move_membership`, *before* it rewrites `circle_members.user_id`, because
--     `email_action_tokens.membership_user_id` follows that by cascade and the
--     trigger fires on it;
--   * `reconcile_contacts`, at the top, because the duplicate-merge path never
--     moves the membership at all — it reaches the token through the *contact*,
--     and the same refusal was waiting there.
--
-- Idempotent: a token already spent is left alone.
--
-- A token spent *here* is marked `retired_at`, and a token spent by being used is
-- not. The difference matters to exactly one reader, `reattach_member`: an
-- emailed link may take a place back from a saved account when the account's own
-- address is not the link's (ADR 0049, decision 6), and a link the member never
-- got to use is still theirs to use, but a link that already moved a place is
-- spent for good. Without the mark the two cannot be told apart.
-- ---------------------------------------------------------------------------

create or replace function private.retire_reentry_links(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.user_id = p_to and p.is_permanent)
    and not exists (
      select 1 from auth.users u where u.id = p_to and not coalesce(u.is_anonymous, true)
    )
  then
    return;
  end if;

  update private.email_action_tokens t
  set used_at = now(), retired_at = now()
  where t.purpose = 'reentry'
    and t.used_at is null
    and t.membership_circle_id = p_circle_id
    and t.membership_user_id = p_from;
end;
$$;

comment on function private.retire_reentry_links(uuid, uuid, uuid) is
  'Spends a membership''s outstanding re-entry links when it passes to an identity with a saved place. Spent, not deleted, so the emailed link can still route to sign-in.';

revoke all on function private.retire_reentry_links(uuid, uuid, uuid) from public;
revoke all on function private.retire_reentry_links(uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/private/stretch_availability.sql
-- ---------------------------------------------------------------------------
-- Who can make a stretch of time (ADR 0051).
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
  'Who of the people the plan is asking can make a stretch, who answered otherwise and who has not answered, as whoCanMake has it in the domain: windows that fully contain it, or "I''m easy". Ids only (ADR 0051).';

revoke all on function private.stretch_availability(uuid, timestamptz, timestamptz) from public;
revoke all on function private.stretch_availability(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function private.stretch_availability(uuid, timestamptz, timestamptz) to service_role;

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
--   * **the link was minted for the person the place was picked from.** Walking the
--     recorded moves back from the holder (through claims), there is a move made by
--     the list, and the first identity in that chain, the one nobody moved the place
--     *to*, is the identity `email_action_tokens.minted_for_user_id` says the link
--     was minted for. That is the story this rule is for: a guest's place was picked
--     from the list and then saved, and the guest's link predates it. Without it, a
--     link minted for somebody who held the place *later* (a taker's own mailbox)
--     could take the place from the real guest once the guest had saved it, and a
--     saved account has no link of its own to answer with. An account that was
--     never picked from (a guest who simply saved) matches nothing here, so their
--     own old links cannot take the place from their own account;
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
  p_contact_id uuid,
  p_minted_for uuid
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
    and p_minted_for is not null
    and exists (
      with recursive chain (id, from_id, to_id, picked) as (
        select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
               a.action = 'circles.member_reattached'
                 and coalesce(a.metadata ->> 'source', 'list') = 'list'
        from private.audit_log a
        where a.resource_type = 'circle' and a.resource_id = p_circle_id
          and a.action in ('circles.member_reattached', 'circles.member_claimed')
          and a.metadata ->> 'to_user_id' = p_holder::text
        union
        select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
               a.action = 'circles.member_reattached'
                 and coalesce(a.metadata ->> 'source', 'list') = 'list'
        from private.audit_log a
        join chain on a.metadata ->> 'to_user_id' = chain.from_id
        where a.resource_type = 'circle' and a.resource_id = p_circle_id
          and a.action in ('circles.member_reattached', 'circles.member_claimed')
      )
      select 1
      where exists (select 1 from chain where picked)
        and exists (
          select 1 from chain c
          where c.from_id = p_minted_for::text
            and not exists (select 1 from chain x where x.to_id = c.from_id)
        )
    )
    and not exists (
      select 1
      from private.email_contacts k
      where k.id = p_contact_id
        and (
          exists (
            select 1 from auth.users u
            where u.id = p_holder and lower(btrim(u.email)) = lower(btrim(k.email_normalized))
          )
          or exists (
            select 1 from auth.identities i
            where i.user_id = p_holder
              and lower(btrim(i.identity_data ->> 'email')) = lower(btrim(k.email_normalized))
          )
        )
    );
$$;

comment on function private.takeback_allowed(uuid, uuid, uuid, uuid) is
  'Whether an emailed re-entry link may take a place back from a saved account: a real account, not the circle''s owner or an open plan''s organiser, whose own address is not the link''s, and and whose place was picked from the identity the link was minted for. Every doubt is a no.';

revoke all on function private.takeback_allowed(uuid, uuid, uuid, uuid) from public;
revoke all on function private.takeback_allowed(uuid, uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/public/confirm_own_time.sql
-- ---------------------------------------------------------------------------
-- Locking in a time the organiser chose themselves (ADR 0051).
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
  'Locks in a time the calling organiser chose, through planning.transition_plan, and refuses it as stale_availability when an answer arrived since the names they were shown (ADR 0051).';

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
-- locked-in time (ADR 0051): a second move inside the backoff of the first
-- would otherwise send "moved to Saturday" after the plan had moved on to
-- Sunday. A move supersedes the confirmation inside the same revision, so the
-- caller passes the revision the plan is still on.
--
-- `skipped`, not `failed`: nothing went wrong. The code says what happened.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_cancel_pending(
  p_plan_id uuid,
  p_revision integer,
  -- The confirmation whose letters must survive: the one a move has just made
  -- (ADR 0051). A move keeps the revision, so a retried `meetup_moved` event
  -- would otherwise skip its own jobs, and the unique key would then refuse to
  -- write them again. Null for a reopen or a cancellation, which keep nothing.
  p_keep_confirmation uuid default null
)
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
      and (p_keep_confirmation is null or j.confirmation_id is distinct from p_keep_confirmation)
    returning 1
  )
  select count(*)::integer from cancelled;
$$;

comment on function public.dispatch_cancel_pending(uuid, integer, uuid) is
  'Skips the still-scheduled reminder and outcome jobs for one plan revision, when its confirmation is cancelled or superseded. Service role only (S1-20).';

revoke all on function public.dispatch_cancel_pending(uuid, integer, uuid) from public;
revoke all on function public.dispatch_cancel_pending(uuid, integer, uuid) from anon, authenticated;
grant execute on function public.dispatch_cancel_pending(uuid, integer, uuid) to service_role;

-- supabase/sql/functions/public/dispatch_enqueue.sql
-- ---------------------------------------------------------------------------
-- The jobs one event turned into, written in one statement.
--
-- `on conflict (idempotency_key) do nothing` is the whole of "delivery is
-- idempotent per recipient, plan revision, kind and occurrence" (spec §5.8).
-- A drain that crashes between enqueueing and marking the event processed runs
-- again and writes nothing new; a duplicate key is "already scheduled", not an
-- error (S1-11).
--
-- The count returned is of rows actually inserted, so a drain can say in its
-- log how much of what it computed was new — a number, not a recipient.
--
-- `circle_id` is the circle a job belongs to when there is no plan to find it
-- through: `about_time` alone (S2-04), which the table's own check holds to
-- carrying a circle and no plan. A plan's jobs leave it null and are found
-- through the plan, as they always were.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_enqueue(p_jobs jsonb)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with wanted as (
    select * from jsonb_to_recordset(coalesce(p_jobs, '[]'::jsonb)) as j (
      channel text,
      kind text,
      user_id uuid,
      contact_id uuid,
      plan_id uuid,
      plan_revision integer,
      circle_id uuid,
      confirmation_id uuid,
      scheduled_for timestamptz,
      idempotency_key text
    )
  ), written as (
    insert into jobs.notification_jobs (
      channel, kind, user_id, contact_id, plan_id, plan_revision, circle_id, confirmation_id,
      scheduled_for, idempotency_key
    )
    select w.channel, w.kind, w.user_id, w.contact_id, w.plan_id, w.plan_revision, w.circle_id,
      w.confirmation_id, w.scheduled_for, w.idempotency_key
    from wanted w
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*)::integer from written;
$$;

comment on function public.dispatch_enqueue(jsonb) is
  'Inserts notification jobs, ignoring any whose idempotency key already exists, and answers how many were new. Service role only (S1-20).';

revoke all on function public.dispatch_enqueue(jsonb) from public;
revoke all on function public.dispatch_enqueue(jsonb) from anon, authenticated;
grant execute on function public.dispatch_enqueue(jsonb) to service_role;

-- supabase/sql/functions/public/edit_confirmation.sql
-- ---------------------------------------------------------------------------
-- Editing a locked-in plan: its time, its place and its note (ADR 0051).
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
-- save that changes nothing is refused as `nothing_to_change`, so a repeated
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
    raise exception 'nothing_to_change' using errcode = 'P0001';
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
  'The calling organiser edits a locked-in plan: a new time is a move (supersede and write a new active confirmation, same revision), a place or note alone updates it in place. Nobody is asked again (ADR 0051).';

revoke all on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) from public;
revoke all on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) from anon, authenticated;
grant execute on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) to authenticated;

-- supabase/sql/functions/public/issue_reentry_token.sql
-- ---------------------------------------------------------------------------
-- The single-use way back into a circle, for a guest with no session.
--
-- Every event email carries one (spec §5.8, §5.11): "a guest returns with no
-- session" is the most common real thing that happens (§9), and without this
-- their only way back is a link somebody else has to resend. Seven days,
-- single-use, and consumed by `reattach-member` (S1-13), which moves the
-- membership onto whatever identity the browser has now.
--
-- **Null for a saved-place identity**, because that is not a fault. Every event
-- email carries a re-entry link and permanent members get event email too; the
-- template simply leaves the link out for somebody who can sign in. Reaching
-- the table's own guard instead — `enforce_reentry_for_guests`, which raises
-- `check_violation` — turned an ordinary rendering decision into a SQLSTATE
-- nothing can translate and a 500 for the reader. The trigger stays: it is the
-- rule, and this is the answer the one caller needs. A sign-in bypass is still
-- impossible, now twice over.
--
-- **For the contact the letter is going to** (S1-19). It used to take the
-- user and hang the token on their most recently verified contact, which is
-- not necessarily the address the email is for: somebody with two verified
-- addresses who later removed the first had the cascade take the re-entry
-- links out of letters sent to the second. The dispatcher knows exactly which
-- contact it is writing to — the job names it — so it says so, and the user is
-- the contact's owner.
--
-- Service role only. It mints nothing itself — the Edge Function generates the
-- token and passes the digest, so the readable form is never a statement
-- parameter and never reaches a query log (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_reentry_token(
  p_circle_id uuid,
  p_contact_id uuid,
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact private.email_contacts;
  token_id uuid;
begin
  -- A verified one: a re-entry link travels in an email, and an email goes
  -- only to an address that proved itself.
  select * into contact from private.email_contacts c where c.id = p_contact_id;

  if not found or contact.status <> 'verified' then
    raise exception 'no_verified_contact' using errcode = 'P0001';
  end if;

  -- Somebody who signs in needs no way back, so there is nothing to issue and
  -- nothing has gone wrong. Checked before the membership, because a permanent
  -- identity's membership is beside the point.
  if exists (
    select 1 from public.profiles pr where pr.user_id = contact.user_id and pr.is_permanent
  ) then
    return null;
  end if;

  -- The membership has to be one. A token for a circle this person is not in
  -- would be a link back into somebody else's circle, and the foreign key that
  -- would have caught it raises a SQLSTATE nothing can translate — a 500 for an
  -- ordinary mistake.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = contact.user_id and m.status = 'active'
  ) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  insert into private.email_action_tokens (
    contact_id, purpose, token_hash, expires_at, membership_circle_id, membership_user_id,
    minted_for_user_id
  )
  values (
    contact.id, 'reentry', p_token_hash, now() + interval '7 days', p_circle_id, contact.user_id,
    contact.user_id
  )
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_reentry_token(uuid, uuid, bytea) is
  'Stores the digest of a seven-day single-use re-entry token for the guest membership of one verified contact''s owner, and returns null for a saved-place identity, which needs no link. The token itself is minted in the Edge Function and never reaches the database. Service role only.';

revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from public;
revoke all on function public.issue_reentry_token(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.issue_reentry_token(uuid, uuid, bytea) to service_role;

-- supabase/sql/functions/public/reattach_member.sql
-- ---------------------------------------------------------------------------
-- reattach_member
--
-- A guest comes back with no session — the expected path, not the rare one
-- (ADR 0006: Safari drops script-writable storage after seven idle days, and
-- chat in-app browsers isolate it). They sign in anonymously again, pick their
-- name from the Continue-as list or arrive on an emailed `/a/<token>` link, and
-- this moves the membership and everything scoped to it onto the new identity.
--
-- Two ways in, one path through. The list names the membership; the token
-- authorises it. Everything after resolution is identical, which is the point
-- ADR 0006 and §10 both make: "this reuses one reattachment path for both the
-- manual and the emailed case".
--
-- The safeguards are all here rather than in the Edge Function, because they
-- are the decision and not the throttle: the caller must be a guest, the target
-- must be a guest (the one exception, an emailed link taking a place back from a
-- saved account, is ADR 0049 decision 6), and a membership may be moved by the
-- list at most three times in seven days. Enforced where it cannot be skipped.
--
-- **The old identity is not deleted here.** It can hold memberships in other
-- circles; `circles.owner_user_id`, `circle_invites.created_by` and
-- `plans.organiser_user_id` reference `auth.users` with no action, so a delete can
-- *fail* at the worst moment; and `run_retention` already deletes anonymous
-- identities with no memberships after thirty days (ADR 0014, §8.5).
-- ---------------------------------------------------------------------------

create or replace function public.reattach_member(
  p_circle_id uuid default null,
  p_target_user_id uuid default null,
  p_reentry_token_hash bytea default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_circle uuid := p_circle_id;
  target uuid := p_target_user_id;
  token private.email_action_tokens;
  chosen public.circles;
  -- `member_reattached`'s analytics payload is `source: 'list' | 'email'`
  -- (packages/contracts/src/analytics.ts), and the reattach rate by source is
  -- what tells us whether the emailed path is worth its machinery. The function
  -- is the only place that knows which one happened.
  entry_source text := case when p_reentry_token_hash is null then 'list' else 'email' end;
  -- The place is held by a saved account and the link may take it back (ADR 0049, 6).
  taking_back boolean := false;
begin
  if caller is null then
    raise exception 'reattach_member requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A saved-place identity does not reattach: it signs in. §10 — "if the
  -- membership belongs to a permanent identity, the page offers that identity's
  -- sign-in instead".
  --
  -- Three records of the same fact, and the strictest wins, which is the rule
  -- this function already applies to the *target* and had no business not
  -- applying to the caller. `auth_is_permanent()` reads the JWT, and a JWT
  -- outlives the event it describes: `linkIdentity` converts the user in place,
  -- so an access token issued minutes earlier keeps `is_anonymous: true` for the
  -- rest of its hour (§14) while `auth.users` and `profiles` have already moved
  -- on. For that hour the stale token was enough to take a *second* guest
  -- membership and attach it to a saved place, where Continue-as can never move
  -- it again.
  if public.auth_is_permanent()
    or exists (select 1 from public.profiles p where p.user_id = caller and p.is_permanent)
    or exists (
      select 1 from auth.users u where u.id = caller and not coalesce(u.is_anonymous, true)
    )
  then
    -- With one exception: the emailed link, opened by the account its membership
    -- now belongs to (§10: "if the browser already holds the right identity, it
    -- simply routes to the plan"). `linkIdentity` keeps the user id, so the token
    -- still names them. Nothing moves and nothing is spent. Anybody else signed in
    -- is refused, and the client can tell the two apart.
    if p_reentry_token_hash is not null then
      select c.* into chosen
      from private.email_action_tokens t
      join public.circle_members m
        on m.circle_id = t.membership_circle_id and m.user_id = t.membership_user_id
      join public.circles c on c.id = t.membership_circle_id
      where t.token_hash = p_reentry_token_hash
        and t.purpose = 'reentry'
        and t.membership_user_id = caller
        and m.status = 'active';

      if found then
        return chosen;
      end if;
    end if;

    raise exception 'caller_is_permanent' using errcode = 'insufficient_privilege';
  end if;

  if (p_reentry_token_hash is null) = (target is null) then
    raise exception 'reattach_member takes a target membership or a re-entry token, not both and not neither'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_reentry_token_hash is not null then
    -- Single-use, 7-day, bound to a membership (§14); spent below, in this
    -- transaction, so a later failure rolls the spend back.
    select * into token
    from private.email_action_tokens t
    where t.token_hash = p_reentry_token_hash
      and t.purpose = 'reentry'
      -- Unspent; or spent by `retire_reentry_links` when the place became a saved
      -- account's, which is the link still being the member's to use (never a link
      -- that already moved a place: that one has no `retired_at`).
      and (t.used_at is null or t.retired_at is not null)
      and t.expires_at > now();

    if not found then
      -- Before calling it invalid: a used or expired link to a membership that
      -- is now a saved place is a link to an account (§10: the page offers that
      -- identity's sign-in), and the client can only show that if told so.
      if exists (
        select 1
        from private.email_action_tokens t
        join public.profiles p on p.user_id = t.membership_user_id
        where t.token_hash = p_reentry_token_hash and t.purpose = 'reentry' and p.is_permanent
      ) then
        raise exception 'target_is_permanent' using errcode = 'insufficient_privilege';
      end if;

      raise exception 'token_invalid' using errcode = 'no_data_found';
    end if;

    target_circle := token.membership_circle_id;
    target := token.membership_user_id;
  end if;

  -- Serialises two reattachments of the same membership: without it both read
  -- a chain of two and both decide they are the third.
  select * into chosen from public.circles c where c.id = target_circle for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  if target = caller then
    -- Already theirs — but *only* if it is. This return used to come before any
    -- membership check at all, so any anonymous session that knew a circle's uuid
    -- could name itself as the target and be handed the circle: the name, the
    -- colour, the zone, the cadence, the short code. RLS refuses that same read,
    -- and §9.4 exposes the name alone and nothing else. It was also an existence
    -- oracle over circle uuids.
    --
    -- A genuine retry is served by the idempotency record before it ever reaches
    -- this function, so nothing is lost by asking.
    if not exists (
      select 1 from public.circle_members m
      where m.circle_id = target_circle and m.user_id = caller and m.status = 'active'
    ) then
      raise exception 'member_not_found' using errcode = 'no_data_found';
    end if;

    return chosen;
  end if;

  -- An archived circle is not somewhere anybody comes back to (ADR 0049), with
  -- an emailed link or without. The same answer a membership that was never
  -- there gets, so this tells nobody which of the two it was.
  if chosen.status <> 'active' then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- The volume limit, **here** as well as in the Edge Function (ADR 0049): this
  -- function is granted to `authenticated`, so a client calling the RPC directly
  -- never meets the Edge Function's counters. A different scope from the Edge one,
  -- so neither eats the other's budget. A refusal raises and rolls the count back,
  -- so this bounds *completed* moves: twenty a circle an hour is far above what
  -- coming back needs and far below what taking people over needs.
  --
  -- The **list** path only. The emailed link is the way back for the rightful
  -- member, so filling the hourly budget with takeovers must not turn it away; the
  -- token has its own single-use, seven-day limit (and the Edge per-token counter).
  if p_reentry_token_hash is null and not public.take_rate_token(
    'reattach_circle_sql', extensions.digest(target_circle::text, 'sha256'), 20, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  -- `for update` on the membership itself, not only on the circle. The circle lock
  -- above serialises two reattachments; it does nothing about `claim_identity`,
  -- which locks `circle_members` rows instead. Without this, a claim running on
  -- another device could move the membership between this check and the move — and
  -- the move would match no rows while the audit row, the event and a successful
  -- answer all went out to a caller who had been given nothing.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = target and m.status = 'active'
    for update
  ) then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- Never onto a saved-place member, by either record: whichever is stale, the
  -- answer has to be no. The one exception is an emailed link that proves an address
  -- the account does not hold (ADR 0049, decision 6): that takes the place *back*.
  if exists (
    select 1 from public.profiles p where p.user_id = target and p.is_permanent
  ) or not exists (
    select 1 from auth.users u where u.id = target and coalesce(u.is_anonymous, false)
  ) then
    if p_reentry_token_hash is null
      or not private.takeback_allowed(target_circle, target, token.contact_id, token.minted_for_user_id)
    then
      raise exception 'target_is_permanent' using errcode = 'insufficient_privilege';
    end if;
    taking_back := true;
  end if;

  -- The caller already belongs here under their own name. Moving a second
  -- membership onto them would collide with their own row, and the thing they
  -- actually want is the session they are already holding.
  if exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = caller
  ) then
    raise exception 'already_member' using errcode = 'unique_violation';
  end if;

  -- Three per membership per seven days (ADR 0006), **counting only the moves made
  -- by picking a name** (ADR 0049; `private.list_moves_this_week`). A move made with
  -- an emailed re-entry link is never refused here, a take-back from a saved account
  -- included, so a member with a live link can always return. What that leaves open
  -- is in ADR 0049, decision 4.
  if p_reentry_token_hash is null
    and private.list_moves_this_week(target_circle, target) >= 3
  then
    raise exception 'reattach_limit' using errcode = 'too_many_rows';
  end if;

  -- The move itself lives in `private.move_membership`, shared with
  -- `claim_identity`: one list of the tables a membership owns, because two
  -- lists means one of them forgets a table and a guest comes back to find
  -- their answers gone.
  if p_reentry_token_hash is not null then
    -- Spent here rather than on the way in. The early return above answers "already
    -- theirs" for somebody who follows their own link while the session still works,
    -- and burning the link for that is a link they cannot use when they actually
    -- need it. Inside the same transaction either way, so a later failure rolls the
    -- spend back with it.
    -- A retired link is now simply used, and cannot take anything back twice.
    update private.email_action_tokens t
    set used_at = coalesce(t.used_at, now()), retired_at = null
    where t.id = token.id;
  end if;

  if taking_back then
    perform private.hand_back_membership(target_circle, target, caller, token.contact_id);
  else
    perform private.move_membership(target_circle, target, caller);
  end if;

  -- And the lock is not taken on trust. If the membership is not the caller's by
  -- now, something moved it and this reattachment achieved nothing — so it says
  -- so, rather than announcing a rejoin that did not happen.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = caller and m.status = 'active'
  ) then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- Ids only (non-negotiable 8). The two ids are what makes the chain above
  -- walkable, and `source` ('list' or 'email') is what lets the cap above count
  -- only the moves it is for; a display name here would be the leak the
  -- constraint on this table refuses anyway.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_reattached', 'circle', target_circle,
          jsonb_build_object('from_user_id', target, 'to_user_id', caller, 'source', entry_source,
                             'from_saved_account', taking_back));

  -- The owner's "Priya rejoined from a new device" (spec §5.1) starts here.
  -- No name: the notification pipeline reads the roster for that.
  -- A place taken back from a saved account is told the same way, with the account's
  -- id on the event so both parties are named: no new channel (ADR 0049, 6).
  perform jobs.emit('circles.member_reattached', 'circle', target_circle,
    jsonb_build_object('circle_id', target_circle, 'user_id', caller, 'source', entry_source)
    || case when taking_back
         then jsonb_build_object('from_user_id', target, 'from_saved_account', true)
         else '{}'::jsonb end);

  return chosen;
end;
$$;

comment on function public.reattach_member(uuid, uuid, bytea) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list or an emailed re-entry token (ADR 0006). Only in an active circle; a per-circle hourly limit on the list path; at most three list moves per membership per seven days, and a move made with a valid re-entry token is never refused by that cap (ADR 0049); never onto a saved-place member; but a valid re-entry token takes a place back from a saved account whose own address is not the link''s, moving that circle only (ADR 0049, decision 6).';

revoke all on function public.reattach_member(uuid, uuid, bytea) from public;
revoke all on function public.reattach_member(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.reattach_member(uuid, uuid, bytea) to authenticated;

-- supabase/sql/functions/public/stretch_availability.sql
-- ---------------------------------------------------------------------------
-- Who a stretch of time works for, for the organiser choosing one
-- (ADR 0051).
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
  'For the plan''s organiser: who of the people the plan is asking can make a stretch, who answered otherwise and who has not, with the plan''s input version and revision. Ids only (ADR 0051).';

revoke all on function public.stretch_availability(uuid, timestamptz, timestamptz) from public;
revoke all on function public.stretch_availability(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.stretch_availability(uuid, timestamptz, timestamptz) to authenticated;

-- END GENERATED: function definitions
