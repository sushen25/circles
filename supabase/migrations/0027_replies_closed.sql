-- ---------------------------------------------------------------------------
-- 0027 — Replies closed with no decision (S2-05, ADR 00XX).
--
-- "Nobody wants to decide" is one of the research's named failure modes, and
-- spec §5.7 answers it with one screen and three ways out: lock in the top
-- option, hand the plan to someone else, or give it one more day. Locking in
-- already existed. This is the other two, and the letters around them.
--
--   * `plans.deadline_extended_on_revision` — the revision whose one "one more
--     day" has been spent. Null until then. On the plan rather than in a table
--     of its own because the screen needs it, and `plans` is what every member
--     of the circle can already read; a revision rather than a flag because an
--     edit or a reopen asks a new question with a new deadline, and earns a
--     new day with it.
--   * `planning.organiser_changed` joins the event catalogue: what the new
--     `hand_off` transition announces, and what the drain turns into the new
--     organiser's letter.
--   * `planning.transitions` gains `hand_off` from `collecting` and `ready`,
--     guarded `organiser` and `hand_off_target` (reseeded from the domain).
--   * Functions: `hand_off_organiser`, `hand_off_candidates` and
--     `extend_deadline` (new); `transition_plan`, `allowed_keys` and
--     `event_for` (the new action); `dispatch_timed_work` (the reminder a day
--     after replies close); `dispatch_claim_due` (a second `replies_closed` is
--     not a duplicate of the first); `dispatch_supersede_closing` (new: a newer
--     `replies_closed` replaces one still held).
--
-- `MIGRATION` in `scripts/gen-sql-functions.mjs`, `scripts/gen-transitions.mjs`
-- and `scripts/gen-events.mjs` now points here.
-- ---------------------------------------------------------------------------

alter table public.plans
  add column deadline_extended_on_revision integer;

comment on column public.plans.deadline_extended_on_revision is
  'The revision whose one "give it one more day" has been spent (spec §5.7), or null. Written only by public.extend_deadline (S2-05).';

-- Never a revision the plan has not reached. Checked, not trusted: the one
-- writer compares it with `revision` to refuse a second extension, and a value
-- from the future would refuse the first one too.
alter table public.plans
  add constraint plans_deadline_extended_on_revision check (
    deadline_extended_on_revision is null
    or deadline_extended_on_revision between 1 and revision
  );

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
  ('collecting', 'quorum_follows', 'collecting', array[]::text[], false),
  ('collecting', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'adjust', 'ready', array['organiser'], false),
  ('ready', 'quorum_follows', 'ready', array[]::text[], false),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('collecting', 'hand_off', 'collecting', array['organiser','hand_off_target'], false),
  ('ready', 'hand_off', 'ready', array['organiser','hand_off_target'], false),
  ('ready', 'expire', 'expired', array[]::text[], false),
  ('ready', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'reopen', 'collecting', array['organiser','no_open_plan'], true),
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
    -- The quorum alone. `quorum_follows` is the circle moving a quorum nobody
    -- chose (ADR 0026); a deadline riding along on it would be a change no
    -- organiser asked for and nobody announced.
    when action = 'quorum_follows' then array['quorum']
    when action in ('edit', 'reopen') then array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local',
      'duration_minutes', 'quorum', 'response_deadline'
    ]
    when action = 'cancel' then array['cancel_note']
    -- Who takes the plan over, and nothing else: a hand-off changes who
    -- decides, not what is being decided (S2-05).
    when action = 'hand_off' then array['organiser_user_id']
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
    -- Not `organiser_accepted`: nobody accepted anything. The organiser gave
    -- the plan to somebody, and the drain tells the new one it is theirs.
    when 'hand_off' then 'planning.organiser_changed'
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

-- supabase/sql/functions/public/dispatch_claim_due.sql
-- ---------------------------------------------------------------------------
-- The email jobs that are due, with the one address each is for.
--
-- Everything a send needs and nothing it does not. Three of the fields are
-- here because S1-18 found that the job alone is not enough to decide whether
-- to send it:
--
--   * `contact_status` — a suppression that lands after the job was written
--     leaves the job `scheduled`. "Permanent failure → skipped" (spec §9) is
--     evaluated when you send, not when the job was made.
--   * `subscribed` — and so is the consent. A `reminder` is written the moment
--     a meetup is confirmed and sits there for days; "Stop emails for this
--     meetup" withdraws the subscription and touches no job, so without this
--     the stop link would stop nothing that was already queued. It is
--     `private.email_recipients_for`, which is the one place the join is
--     written (S1-18), asked again at the moment of sending.
--   * `plan_state` — a verification queued while a plan was live is still
--     `scheduled` after the plan is cancelled, and sending it is a letter
--     about a meetup that is over.
--   * `circle_archived` — "Archiving stops all prompts" (spec §5.2), and a
--     reminder written before the owner archived is still `scheduled` after.
--     Asked at the moment of sending, so bringing the circle back lets what
--     was queued go rather than losing it (S1-23). The circle is the plan's,
--     or — for `about_time`, which has no plan — the job's own `circle_id`
--     (S2-04). Found through the plan alone, a cadence nudge's circle was
--     always null and archiving never stopped one.
--   * `organiser_email_muted` — the contact's owner has turned "Emails about
--     plans you organise" off (ADR 0029). `did_it_happen` is written when a
--     meetup is confirmed and sent the next morning, so a switch read only
--     when the job was written would not stop the letter it was turned off
--     for. Which kinds it stops is the domain's (`organiserEmailStopped`);
--     this says only whether it is off.
--   * `superseded` — "one copy per event" is the sender's job, not the
--     writer's. One address can be held by two contacts since 0009: two
--     siblings subscribed to the same decided plan, or a guest who joined
--     twice, produce two jobs for one mailbox. The flag marks a job whose
--     letter has **already gone** to that address.
--
--     Only `sent`, and that is the whole correction. It used to mark a job
--     whose sibling was merely `scheduled` and sorted earlier — which suppressed
--     the eligible copy when the earlier one turned out not to be: the first
--     was skipped for having left the circle, the second was skipped as a
--     duplicate of it, and the mailbox got nothing at all (review round 3).
--     A copy cannot be a duplicate of one that was never sent, so the
--     within-a-batch half of the rule belongs after eligibility, in the sender,
--     where it is keyed on the address a letter actually went to.
--
-- The dedupe is by `(kind, plan, revision, address)` and is applied only to
-- the kinds whose occurrence is *determined* by the plan revision —
-- `locked_in`, `cancelled`, `reminder`, `did_it_happen_participant`, and the
-- organiser kinds, which have one contact anyway. `changed` and `verify_email`
-- are excluded on purpose: both can legitimately occur twice in one revision
-- (a second material change, a second verification request), they are keyed by
-- change id and verification id for exactly that reason, and deduping them by
-- address is how nobody gets told the venue moved. `about_time` (Slice 2,
-- SUS-52) is excluded for a third reason: it belongs to a circle and has no
-- plan at all, so every one of them matches every other on
-- `plan_id is not distinct from null` and an address would receive exactly
-- one cadence nudge, ever. `replies_closed` (S2-05) is excluded because its
-- occurrence is the deadline and not the revision: "give it one more day" is
-- an `adjust`, so the second closure shares the first one's revision and
-- address, and deduping it here dropped exactly the letter its occurrence was
-- changed to let through — as it would the reminder a day later. It goes to
-- one organiser's one contact, so there is no sibling to collapse. The sender
-- holds the same four in `NEVER_COLLAPSED`, because the rule has a half on
-- each side of the wire; they had drifted by one kind when review round 4
-- looked.
--
-- Push is not claimed here. Slice 1 writes no push job — a kind whose only
-- channel is push finds no device and produces no recipient — and Slice 3
-- (SUS-59) adds the Expo half with its own receipts.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_claim_due(p_limit integer default 50)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with due as (
    select j.*
    from jobs.notification_jobs j
    where j.status = 'scheduled'
      and j.channel = 'email'
      and j.scheduled_for <= now()
    order by j.scheduled_for, j.created_at, j.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'kind', j.kind,
    'contact_id', j.contact_id,
    'user_id', c.user_id,
    'plan_id', j.plan_id,
    'plan_revision', j.plan_revision,
    'idempotency_key', j.idempotency_key,
    'attempt_count', j.attempt_count,
    'email', c.email_normalized,
    'contact_status', c.status,
    'subscribed', exists (
      select 1 from private.email_recipients_for(j.plan_id) r where r.contact_id = j.contact_id
    ),
    -- `email_recipients_for` answers one question with three conditions in it,
    -- and the sender has to tell them apart: somebody who was removed from the
    -- circle withdrew nothing, and recording `subscription_withdrawn` against
    -- them tells whoever reads `last_error` the wrong story (review round 2).
    'member_active', exists (
      select 1 from public.circle_members m
      where m.circle_id = cir.id and m.user_id = c.user_id and m.status = 'active'
    ),
    'plan_state', p.state,
    'plan_short_code', p.short_code,
    'plan_current_revision', p.revision,
    'circle_id', cir.id,
    'circle_name', cir.name,
    'circle_archived', coalesce(cir.status = 'archived', false),
    'organiser_email_muted', coalesce((
      select pr.muted_organiser_email from public.profiles pr where pr.user_id = c.user_id
    ), false),
    'superseded', j.kind not in ('changed', 'verify_email', 'about_time', 'replies_closed') and exists (
      select 1
      from jobs.notification_jobs o
      join private.email_contacts oc on oc.id = o.contact_id
      where o.id <> j.id
        and o.kind = j.kind
        and o.plan_id is not distinct from j.plan_id
        and o.plan_revision is not distinct from j.plan_revision
        and oc.email_hash = c.email_hash
        and o.status = 'sent'
    )
  ) order by j.scheduled_for, j.created_at, j.id), '[]'::jsonb)
  from due j
  join private.email_contacts c on c.id = j.contact_id
  left join public.plans p on p.id = j.plan_id
  left join public.circles cir on cir.id = coalesce(p.circle_id, j.circle_id);
$$;

comment on function public.dispatch_claim_due(integer) is
  'The due email jobs, each with its address, the contact''s status now, the plan''s state now, whether its owner has turned organiser email off, and whether an earlier job already covers this address for this event. Service role only (S1-20).';

revoke all on function public.dispatch_claim_due(integer) from public;
revoke all on function public.dispatch_claim_due(integer) from anon, authenticated;
grant execute on function public.dispatch_claim_due(integer) to service_role;

-- supabase/sql/functions/public/dispatch_supersede_closing.sql
-- ---------------------------------------------------------------------------
-- A newer "replies are closed" takes the place of one still waiting (S2-05).
--
-- `replies_closed` is once per deadline (ADR 00XX), and a letter written for
-- one deadline can wait for quiet hours while the organiser moves the
-- deadline and it passes again. At 08:00 both would be true of a plan whose
-- replies are closed and nothing is locked in, so both would go — two
-- identical letters. The send-time check cannot tell them apart: a job does
-- not carry the deadline it was written for.
--
-- So the drain, before it writes a `replies_closed`, skips every one still
-- `scheduled` for the plan except the ones it is about to write (`p_keep`, by
-- idempotency key). The exception is what makes a re-drained event safe: a
-- drain that crashed after enqueueing and runs again must not skip the job it
-- wrote the first time and then find its own key already taken.
--
-- `skipped` / `superseded`, as `dispatch_cancel_pending` records it.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_supersede_closing(p_plan_id uuid, p_keep text[])
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with superseded as (
    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'superseded', updated_at = now()
    where j.plan_id = p_plan_id
      and j.kind = 'replies_closed'
      and j.status = 'scheduled'
      and j.idempotency_key <> all (coalesce(p_keep, array[]::text[]))
    returning 1
  )
  select count(*)::integer from superseded;
$$;

comment on function public.dispatch_supersede_closing(uuid, text[]) is
  'Skips the still-scheduled replies_closed jobs for a plan, except the keys about to be written, when a newer one is written. Service role only (S2-05).';

revoke all on function public.dispatch_supersede_closing(uuid, text[]) from public;
revoke all on function public.dispatch_supersede_closing(uuid, text[]) from anon, authenticated;
grant execute on function public.dispatch_supersede_closing(uuid, text[]) to service_role;

-- supabase/sql/functions/public/dispatch_timed_work.sql
-- ---------------------------------------------------------------------------
-- The work a clock creates, discovered from data rather than from a timer
-- (architecture §9.3).
--
-- Five things, every run, all of them queries:
--
-- 1. **A deadline that has passed.** Nothing emits `planning.deadline_passed`
--    — it is not a transition, and S1-11 left it for the sweep to raise. It is
--    emitted into the outbox rather than turned into a job here, so that the
--    one place events become notifications stays the drain. Once per
--    **deadline**, not once per plan: "give it one more day" (spec §5.7) moves
--    the deadline out and it passes again, and a marker keyed on the plan
--    would announce the second one to nobody. The outbox is still the marker,
--    which holds because a plan cannot outlive its own window by the thirty
--    days retention keeps events for (rule 2 below closes it long before).
--
--    **And once more, a day later, if the plan is still `ready`** (S2-05,
--    ADR 00XX): the same event with `follow_up: '+24h'`, and its own marker.
--    Due a day after the first letter was *announced* rather than a day after
--    the deadline, so a dispatcher that was down does not send both at once;
--    and never more than a day late, so a plan that has sat undecided for a
--    week is not reminded on the day this was deployed. `ready`, not
--    `collecting`: the follow-up is about an option waiting to be locked in.
--
-- 2. **A plan whose last possible start has gone.** Spec §9: "the plan stays
--    decidable until the last candidate start, then expires." The last start
--    is `public.plan_last_possible_start` — the same function the deadline
--    constraint uses, so the moment a plan stops being decidable and the
--    moment it may no longer be answered are one definition rather than two.
--    `expire` has no guards, so the actor is null: nobody did this, the window
--    closed.
--
-- 3. **A plan whose candidate set is stale.** After ADR 0018 every answer
--    recalculates in the request that caused it, and the cases with no request
--    to attach to are this function's: a member removed by a trigger, a
--    recalculation that lost its compare-and-set. Found by asking which plans
--    have no `candidate_sets` row at the version they are on (S1-16).
--
-- 4. **A deadline 24 hours out.** The plans, not the people: who is owed a
--    reminder is `recipientsFor('deadline_approaching')`'s answer and belongs
--    in the domain.
--
-- 5. **A circle that may be due a nudge** (S2-04). The circles, not the
--    decision: whether one is owed, for which due date and to whom is
--    `nudgeDueDate` and `nudgeChoice`'s, in the domain. This is a coarse
--    superset of the circles that could be owed one, so the domain is asked
--    about few circles rather than all of them: active, with a goal and a
--    history, nothing open, not snoozed, not already decided for this cycle
--    (the prompt counted from its current `last_met_at`) — and met long
--    enough ago that the lead window can have opened. That last bound is the
--    domain's own arithmetic: the cadence added forward from the meetup on the
--    circle's wall clock, where a month is a calendar month clamped at its
--    end, less the lead days, less one more day for a DST hour. So no circle
--    the domain would call due is ever left out or named late; one it would
--    not is merely asked about and told no. Subtracting a month back from
--    now instead named a circle that met at the start of February two days
--    after its card appeared (review round 2). Oldest first, so a circle that
--    has waited longest is asked first.
--
-- Each transition is attempted on its own and a refusal is counted rather than
-- thrown: a plan that was confirmed between the select and the update is a
-- race with a correct outcome, and losing it must not abandon the rest of the
-- batch.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_timed_work(p_limit integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  batch integer := greatest(1, least(coalesce(p_limit, 50), 200));
  target record;
  closed integer := 0;
  followed integer := 0;
  expired integer := 0;
  refused integer := 0;
begin
  for target in
    select p.id, p.circle_id, p.revision, p.response_deadline
    from public.plans p
    where p.state in ('collecting', 'ready')
      and p.response_deadline <= now()
      and not exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed'
          and o.aggregate_id = p.id
          and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
      )
    order by p.response_deadline
    limit batch
  loop
    perform jobs.emit('planning.deadline_passed', 'plan', target.id, jsonb_build_object(
      'plan_id', target.id, 'circle_id', target.circle_id, 'revision', target.revision,
      -- The marker, and the reason it is in the payload rather than implied by
      -- the row: spec §5.7's replies-closed screen offers "give it one more
      -- day", and an extended deadline passes a second time. Keyed on the plan
      -- alone, the second one is announced to nobody — and the organiser's only
      -- channel in Slice 1 is this letter. An instant is an allowed payload
      -- value: `jobs.carries_content` takes `[A-Za-z0-9_./:+-]` up to 40, and
      -- this is 32.
      --
      -- **To the microsecond, and rendered rather than cast.** The first
      -- version of this used `OF:00` and lost the fraction, so the comparison
      -- below — which is at full precision — never matched a marker it had
      -- written itself, and every plan with a fractional deadline was
      -- announced again every minute for as long as it stayed open. Almost
      -- every deadline is fractional: `defaultDeadline` is `now + 1h`. Found
      -- in review round 2, and it is why the round-2 test runs the sweep twice
      -- against one deadline rather than once against two.
      --
      -- Rendered in UTC with an explicit offset rather than left to jsonb's
      -- own cast, which would use the session's `TimeZone` and make the stored
      -- string depend on who called.
      'deadline', to_char(target.response_deadline at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')));
    closed := closed + 1;
  end loop;

  -- S2-05: the reminder a day after the first, while nothing is decided.
  for target in
    select p.id, p.circle_id, p.revision, p.response_deadline
    from public.plans p
    where p.state = 'ready'
      and exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed'
          and o.aggregate_id = p.id
          and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
          and not (o.payload ? 'follow_up')
          and o.occurred_at <= now() - interval '24 hours'
          and o.occurred_at > now() - interval '48 hours'
      )
      and not exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed'
          and o.aggregate_id = p.id
          and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
          and o.payload ? 'follow_up'
      )
    order by p.response_deadline
    limit batch
  loop
    perform jobs.emit('planning.deadline_passed', 'plan', target.id, jsonb_build_object(
      'plan_id', target.id, 'circle_id', target.circle_id, 'revision', target.revision,
      'deadline', to_char(target.response_deadline at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
      'follow_up', '+24h'));
    followed := followed + 1;
  end loop;

  for target in
    select p.id
    from public.plans p
    where p.state in ('collecting', 'ready')
      and public.plan_last_possible_start(
            p.window_end, p.daily_end_local, p.duration_minutes, p.time_zone) <= now()
    order by p.window_end
    limit batch
  loop
    begin
      perform planning.transition_plan(target.id, 'expire', null);
      expired := expired + 1;
    exception when others then
      refused := refused + 1;
    end;
  end loop;

  return jsonb_build_object(
    'deadline_passed', closed,
    'followed_up', followed,
    'expired', expired,
    'expire_refused', refused,
    'stale', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and not exists (
            select 1 from public.candidate_sets cs
            where cs.plan_id = p.id
              and cs.revision = p.revision
              and cs.input_version = p.input_version
          )
        order by p.updated_at
        limit least(batch, 20)
      ) x
    ), '[]'::jsonb),
    'approaching', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and p.response_deadline > now()
          and p.response_deadline <= now() + interval '24 hours'
        order by p.response_deadline
        limit batch
      ) x
    ), '[]'::jsonb),
    'cadence', coalesce((
      select jsonb_agg(x.id) from (
        select c.id
        from public.circles c
        where c.status = 'active'
          and c.cadence <> 'none'
          and c.last_met_at is not null
          and ((c.last_met_at at time zone c.time_zone) + case c.cadence
            when 'weekly' then interval '7 days'
            when 'fortnightly' then interval '14 days'
            when 'monthly' then interval '1 month'
            else interval '2 months'
          end - case c.cadence
            when 'weekly' then interval '3 days'
            when 'fortnightly' then interval '3 days'
            else interval '8 days'
          end) at time zone c.time_zone <= now()
          and (c.cadence_snoozed_until is null or c.cadence_snoozed_until <= now())
          and not exists (
            select 1 from public.plans p
            where p.circle_id = c.id
              and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
          )
          and not exists (
            select 1 from private.cadence_prompts cp
            where cp.circle_id = c.id and cp.last_met_at = c.last_met_at
          )
        order by c.last_met_at
        limit batch
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.dispatch_timed_work(integer) is
  'One pass of the time-based work: emits planning.deadline_passed once per deadline and once more a day later while the plan is ready, expires plans whose last possible start has gone, and names the plans with a stale candidate set or a deadline within 24 hours, and the circles that may be due a cadence nudge. Service role only (S1-20, S2-04).';

revoke all on function public.dispatch_timed_work(integer) from public;
revoke all on function public.dispatch_timed_work(integer) from anon, authenticated;
grant execute on function public.dispatch_timed_work(integer) to service_role;

-- supabase/sql/functions/public/extend_deadline.sql
-- ---------------------------------------------------------------------------
-- "Give it one more day" (spec §5.7), carried out.
--
-- The same three rules as `oneMoreDay` in `packages/domain/planning`, which is
-- the copy the screen asks before offering the button:
--
--   * **A day from now, or from the deadline if that is later.** Opened hours
--     after replies closed, a day counted from the deadline is not one.
--   * **Never later than thirty minutes before the last possible start.** A
--     deadline may already sit at the last start (ADR 0010), and then there is
--     nothing to give: `no_time_to_extend`, never a save that changes nothing.
--   * **Once per revision** — `plans.deadline_extended_on_revision` holds the
--     revision whose one extension has been spent: `already_extended`. An edit
--     or a reopen is a new question and earns its own day.
--
-- The write is an `adjust` through `planning.transition_plan`, which is what a
-- deadline-only change already is (spec §5.3): it costs nobody a second reply,
-- leaves a `ready` plan ready, and `revise_plan`'s own reasoning applies — a
-- passed deadline may be moved, only never *to* the past. The transition's
-- guards are checked here first, from the same table, so that a member who is
-- not organising is told that rather than that the plan was extended already.
--
-- What it sets off, it sets off by being an `adjust`: the old deadline's
-- `replies_closed` letter, if quiet hours still hold it, is dropped at send
-- time as `replies_reopened`, and the new deadline is announced when it passes
-- — once, because `replies_closed`'s occurrence is the deadline (ADR 00XX).
-- ---------------------------------------------------------------------------

create or replace function public.extend_deadline(p_plan_id uuid)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  cutoff timestamptz;
  next_deadline timestamptz;
  extended public.plans;
begin
  if caller is null then
    raise exception 'extend_deadline requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from planning.transitions t where t.from_state = plan.state and t.action = 'adjust'
  ) then
    if plan.state in ('completed', 'expired', 'cancelled') then
      raise exception 'plan_is_finished' using errcode = 'P0001';
    end if;
    raise exception 'wrong_state' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller or not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = caller and m.status = 'active'
  ) then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if plan.deadline_extended_on_revision is not distinct from plan.revision then
    raise exception 'already_extended' using errcode = 'P0001';
  end if;

  cutoff := public.plan_last_possible_start(
    plan.window_end, plan.daily_end_local, plan.duration_minutes, plan.time_zone
  ) - interval '30 minutes';
  next_deadline := least(greatest(plan.response_deadline, now()) + interval '24 hours', cutoff);
  if next_deadline <= plan.response_deadline or next_deadline <= now() then
    raise exception 'no_time_to_extend' using errcode = 'P0001';
  end if;

  extended := planning.transition_plan(
    plan.id, 'adjust', caller, jsonb_build_object('response_deadline', next_deadline));

  update public.plans p
  set deadline_extended_on_revision = extended.revision
  where p.id = extended.id
  returning * into extended;

  return extended;
end;
$$;

comment on function public.extend_deadline(uuid) is
  'Gives the calling organiser''s plan one more day of replies: a day from the later of now and the deadline, never past thirty minutes before the last possible start, once per revision. An adjust through planning.transition_plan (S2-05).';

revoke all on function public.extend_deadline(uuid) from public;
revoke all on function public.extend_deadline(uuid) from anon, authenticated;
grant execute on function public.extend_deadline(uuid) to authenticated;

-- supabase/sql/functions/public/hand_off_candidates.sql
-- ---------------------------------------------------------------------------
-- Who the organiser could hand a plan to (spec §5.7), for the sheet that asks.
--
-- Every active member the plan's current revision is asking, but the
-- organiser, with whether they have a saved place — the people
-- `hand_off_target` could accept but for that. Somebody in the circle the plan
-- never asked is not listed: its letters could not reach them. The sheet shows the ones without one greyed out with
-- "needs a saved place" rather than letting a tap be refused, and the client
-- cannot tell on its own: `profiles` is readable by its owner alone.
--
-- Whether somebody is a guest is not a secret in the circle — the
-- "Continue as" list names the circle's guests to anyone holding its link
-- (`guest_members_for_reattach`, ADR 0006) — but it is still only answered to
-- the one person with a use for it: the plan's organiser, while they are an
-- active member. Anybody else is refused as `not_the_organiser`, the refusal
-- the hand-off itself would give them.
--
-- Names are the circle's own snapshots, as every other roster read shows.
-- ---------------------------------------------------------------------------

create or replace function public.hand_off_candidates(p_plan_id uuid)
returns table (member_user_id uuid, display_name text, has_saved_place boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if caller is null
    or plan.organiser_user_id is distinct from caller
    or not exists (
      select 1 from public.circle_members m
      where m.circle_id = plan.circle_id and m.user_id = caller and m.status = 'active'
    )
  then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  return query
  select m.user_id, m.display_name_snapshot, coalesce(pr.is_permanent, false)
  from public.circle_members m
  left join public.profiles pr on pr.user_id = m.user_id
  join public.plan_participants pp
    on pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = m.user_id
  where m.circle_id = plan.circle_id
    and m.status = 'active'
    and m.user_id <> caller
  order by pp.joined_at, m.user_id;
end;
$$;

comment on function public.hand_off_candidates(uuid) is
  'The active members a plan''s current revision asks, but its organiser, each with whether they have a saved place: whom the organiser could hand it to. The calling organiser only (S2-05).';

revoke all on function public.hand_off_candidates(uuid) from public;
revoke all on function public.hand_off_candidates(uuid) from anon, authenticated;
grant execute on function public.hand_off_candidates(uuid) to authenticated;

-- supabase/sql/functions/public/hand_off_organiser.sql
-- ---------------------------------------------------------------------------
-- "Hand this to someone else" (spec §5.7, §9: "the organiser wants out").
--
-- The organiser gives the plan to another member, and that is one write with
-- two halves, which is why it is one function rather than a transition and a
-- clean-up somebody might forget:
--
--   * **The transition.** `planning.transition_plan(…, 'hand_off', …)` holds
--     every rule: only the organiser may (`organiser`), only from a plan with
--     something left to decide (`collecting`, `ready`), and only to an active
--     member the plan is asking, with a saved place, who is not the organiser
--     already (`hand_off_target` — spec §8.2's "organiser roles belong to
--     saved-place identities only"). It emits `planning.organiser_changed`, which the drain
--     turns into the new organiser's letter.
--   * **The letters already written to the old one.** `dispatch_context` reads
--     `plans.organiser_user_id`, so the organiser kinds go to the new organiser
--     from the next tick. A job already in the table names the old organiser's
--     contact and would still be sent to them: a `replies_closed` held
--     overnight by quiet hours, an `options_ready` retrying. They are skipped
--     here, in the transaction that moves the plan — the pattern of
--     `dispatch_cancel_pending`, keyed by the person rather than the revision.
--     The sender checks again at send time (`handedOver` in the dispatcher), so
--     a job the drain writes in the same tick is caught too.
--
-- The kinds are the three whose audience is `organiser` in the domain's
-- `NOTIFICATION_KINDS`: `about_time` is the other organiser-addressed kind and
-- belongs to a circle, not to this plan.
--
-- `auth.uid()` is the actor, never an argument, for the reason `revise_plan`
-- gives: a client-callable function that took one would let a caller name
-- somebody else.
-- ---------------------------------------------------------------------------

create or replace function public.hand_off_organiser(p_plan_id uuid, p_to_user_id uuid)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  handed public.plans;
begin
  if caller is null then
    raise exception 'hand_off_organiser requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;
  if p_to_user_id is null then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  handed := planning.transition_plan(
    p_plan_id, 'hand_off', caller, jsonb_build_object('organiser_user_id', p_to_user_id));

  update jobs.notification_jobs j
  set status = 'skipped', last_error = 'organiser_changed', updated_at = now()
  where j.plan_id = handed.id
    and j.status = 'scheduled'
    and j.kind in ('options_ready', 'replies_closed', 'did_it_happen')
    and (
      j.user_id = caller
      or exists (
        select 1 from private.email_contacts c where c.id = j.contact_id and c.user_id = caller
      )
    );

  return handed;
end;
$$;

comment on function public.hand_off_organiser(uuid, uuid) is
  'Gives the calling organiser''s plan to another active, saved-place member through planning.transition_plan, and skips the organiser letters already queued for the caller, in one transaction (S2-05).';

revoke all on function public.hand_off_organiser(uuid, uuid) from public;
revoke all on function public.hand_off_organiser(uuid, uuid) from anon, authenticated;
grant execute on function public.hand_off_organiser(uuid, uuid) to authenticated;

-- END GENERATED: function definitions
