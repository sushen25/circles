-- ---------------------------------------------------------------------------
-- 0011 — the plan lifecycle's application layer (S1-15).
--
-- No new tables. Everything a plan needs already exists: `plans` and its two
-- audience tables from 0003, the state machine and `planning.transition_plan`
-- from 0003 and 0004, `circle_invites` from 0002. What was missing was the way
-- in — three definer functions that a client may call and that do the several
-- writes each of these use cases is made of.
--
--   `public.issue_invite`        the circle's one live link, and resetting it
--   `public.create_plan`         a draft, its audience, and the transition out
--   `public.reask_audience`      what an edit would cost, as facts
--
-- All three in `public`, which is not where planning's work belongs but is the
-- only schema PostgREST exposes — and `070_communication_jobs.sql` asserts that
-- nothing outside it is client-callable. `planning` keeps what only SQL calls.
--
-- Editing, cancelling and reopening need nothing new: they are
-- `planning.transition_plan(plan, 'edit' | 'cancel' | 'reopen', actor, payload)`,
-- which already has the guards, the revision bump, the event and — through
-- `supersede_on_leaving_confirmed` — the confirmation that has to go with them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The state machine, reseeded.
--
-- 0003 has shipped, so a domain change cannot be regenerated in place — the
-- generator's own header says as much, and `MIGRATION` in
-- `scripts/gen-transitions.mjs` now points here. The table is emptied and
-- rewritten rather than patched: it is a mirror of
-- `packages/domain/src/planning/state-machine.ts`, and a mirror with one row
-- amended by hand is no longer one.
--
-- What changed: `adjust`, from `collecting` and from `ready`, which is how the
-- quorum and the deadline move without a new revision (spec §5.3).
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
  ('collecting', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'adjust', 'ready', array['organiser'], false),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('ready', 'expire', 'expired', array[]::text[], false),
  ('ready', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'reopen', 'collecting', array['organiser'], true),
  ('confirmed', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'report_outcome', 'completed', array['organiser'], false);
-- END GENERATED: transitions

-- ---------------------------------------------------------------------------
-- `create_circle` gains the invite digest, so a circle and the link that fills
-- it are made together or not at all (spec §5.1). A new parameter is a new
-- function rather than a replacement, and leaving the old one would make every
-- call that does not name the digest ambiguous — so the shipped signature goes
-- here, once, before the generated block redefines it.
-- ---------------------------------------------------------------------------
drop function if exists public.create_circle(text, text, text, text, text);

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
  -- `event_for`.
  event_name := planning.event_for(rule.from_state, p_action);
  if event_name is null
    and not (p_action = 'candidates_gone' or (p_action = 'cancel' and rule.from_state = 'seeking'))
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

-- supabase/sql/functions/public/cancel_plan.sql
-- ---------------------------------------------------------------------------
-- Calling it off.
--
-- The wrapper exists for the reasons `revise_plan`'s does: `planning` is not
-- exposed, and the actor must be `auth.uid()` rather than something a caller
-- says. Which event goes out is not this function's decision either —
-- `planning.event_for` sends `confirmation.meetup_cancelled` when the plan was
-- confirmed and `planning.plan_cancelled` when it was only being asked about,
-- because "Thursday is off" reaches people who put it in a calendar and
-- withdrawing an ask does not.
--
-- The note is the organiser's own words. It is stored on the plan for the
-- notification pipeline to read and never travels in the event: an outbox
-- payload is checked by `jobs.carries_content`, which refuses free text at any
-- depth (non-negotiable 8).
-- ---------------------------------------------------------------------------

create or replace function public.cancel_plan(
  p_plan_id uuid,
  p_note text default null
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'cancel_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  return planning.transition_plan(
    p_plan_id,
    'cancel',
    caller,
    case
      when p_note is null or btrim(p_note) = '' then '{}'::jsonb
      else jsonb_build_object('cancel_note', p_note)
    end
  );
end;
$$;

comment on function public.cancel_plan(uuid, text) is
  'Cancels a plan as the calling organiser, with an optional note the notices carry. Which cancellation event goes out is planning.event_for''s, from the state it was in.';

revoke all on function public.cancel_plan(uuid, text) from public;
revoke all on function public.cancel_plan(uuid, text) from anon, authenticated;
grant execute on function public.cancel_plan(uuid, text) to authenticated;

-- supabase/sql/functions/public/create_circle.sql
-- ---------------------------------------------------------------------------
-- create_circle
--
-- The only way a circle comes into existence. A definer function rather than an
-- insert policy, because a circle and its owner's membership have to appear
-- together — an insert policy would leave a window in which a circle exists
-- with no members and therefore no one who can see it.
--
-- The invite link is here for the same reason, one step further out. Spec §5.1
-- makes the circle and the link one step of one flow, and `create-circle` used
-- to make them with two RPCs: a failure between them left a circle nobody could
-- be invited to, a `circles.circle_created` event about it, and a person looking
-- at an error message. Given a digest, the link is issued in this transaction,
-- so the answer to "did that work?" is the same answer for both.
-- ---------------------------------------------------------------------------

create or replace function public.create_circle(
  name text,
  color text,
  time_zone text,
  -- Required, and therefore ahead of the optional cadence. §9.1 has every
  -- mutation idempotent on a client-supplied key, and an optional one is a key
  -- nobody sends: the retry it guards against is the one where the client never
  -- saw a response and cannot tell a timeout from a failure.
  idempotency_key text,
  cadence text default 'none',
  -- SHA-256 of the invite secret, which the server never sees (§14). Optional
  -- because a circle is a circle without a link — fixtures and tests make them
  -- that way — and passed by `create-circle` always, because the flow it serves
  -- promises both.
  invite_secret_hash bytea default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The `ShortCode` contract's alphabet (`packages/contracts/src/ids.ts`).
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  caller uuid := (select auth.uid());
  caller_name text;
  created public.circles;
  code text;
  i integer;
begin
  if not public.auth_is_permanent() then
    -- The organiser gate (ADR 0004). Worded as a practical need by the client;
    -- here it is simply a refusal.
    raise exception 'creating a circle needs a saved place'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(create_circle.idempotency_key), '') = '' then
    raise exception 'create_circle needs an idempotency key'
      using errcode = 'null_value_not_allowed';
  end if;

  -- A retry returns what the first attempt made. Creating a circle is the one
  -- mutation where a lost response is expensive: the client cannot tell a
  -- timeout from a failure, and trying again would leave the person with two
  -- circles and no way to tell which one they gave the link out for.
  select * into created
  from public.circles c
  where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
  if found then
    return created;
  end if;

  select p.display_name into caller_name from public.profiles p where p.user_id = caller;
  if caller_name is null then
    raise exception 'no profile for %', caller using errcode = 'foreign_key_violation';
  end if;

  -- Ten characters from the `ShortCode` alphabet — no `0`/`o`, no `1`/`l`/`i`,
  -- because a short code is read aloud and retyped. Not a secret and not
  -- required to be unguessable: the invite secret is the capability, and it
  -- never reaches a server (§14). The loop retries on collision rather than
  -- hoping there is none.
  loop
    code := '';
    for i in 1..10 loop
      code := code || substr(
        alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)),
        1
      );
    end loop;
    exit when not exists (select 1 from public.circles c where c.short_code = code);
  end loop;

  insert into public.circles
    (owner_user_id, name, color, time_zone, cadence, short_code, creation_key)
  values (caller, create_circle.name, create_circle.color, create_circle.time_zone,
          create_circle.cadence, code, create_circle.idempotency_key)
  returning * into created;

  insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
  values (created.id, caller, caller_name, 'owner');

  -- The link, in the same transaction, through the function that owns what
  -- issuing one means: the audit row, the revocation of any earlier link, and
  -- the rule that the first link announces nothing because the circle's own
  -- creation already did. It checks that the caller owns the circle, which they
  -- do — they are two statements away from having made it.
  if create_circle.invite_secret_hash is not null then
    perform public.issue_invite(created.id, create_circle.invite_secret_hash);
  end if;

  -- `circles.circle_created` and `circles.member_joined` are written to
  -- `jobs.outbox` by the row triggers in 0006, in this transaction — on the
  -- rows rather than here, so that every writer of a circle or a membership
  -- announces it, not only this function.

  return created;

exception
  when unique_violation then
    -- Two identical requests in flight at once: the index caught the second, and
    -- the row the first one wrote is the answer.
    select * into created
    from public.circles c
    where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
    if found then
      return created;
    end if;
    raise;
end;
$$;

comment on function public.create_circle(text, text, text, text, text, bytea) is
  'Creates a circle, its owner membership and — given a digest — its invite link, in one transaction. Requires a permanent identity (ADR 0004).';

revoke all on function public.create_circle(text, text, text, text, text, bytea) from public;
revoke all on function public.create_circle(text, text, text, text, text, bytea) from anon, authenticated;
grant execute on function public.create_circle(text, text, text, text, text, bytea) to authenticated;

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
  p_required_member_ids uuid[] default null
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
    duration_minutes, quorum, response_deadline, short_code
  )
  values (
    p_circle_id, 'named', caller, p_title, p_category, circle.time_zone,
    p_window_start, p_window_end, p_daily_start_local, p_daily_end_local,
    p_duration_minutes, p_quorum, p_response_deadline, code
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

comment on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[]) is
  'Creates a named plan as a draft, addresses it to the circle''s active members, and moves it to collecting through the state machine. Defaults are resolved by the domain before it is called.';

revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[]) from public;
revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[]) from anon, authenticated;
grant execute on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[]) to authenticated;

-- supabase/sql/functions/public/issue_invite.sql
-- ---------------------------------------------------------------------------
-- The circle's one live invite link.
--
-- "The owner shares one revocable circle link" and "can remove a member and
-- reset the link without disturbing existing members" (spec §5.2). Issuing and
-- resetting are the same operation — a new secret, and every earlier one dead —
-- so they are one function. `create-circle` calls it for the first link; the
-- reset endpoint (S1-23) will call it for every later one.
--
-- **The secret never arrives.** The Edge Function generates 32 random bytes,
-- hashes them, and passes the digest; the readable form goes back to the client
-- once, in the response, to build `/join#<secret>`. §14: the secret lives in the
-- URL fragment, which no server sees, and only its SHA-256 is stored.
--
-- Revoking first, in the same statement, is what makes "reset" mean something:
-- two live invites would be two capabilities, and rotating would stop
-- invalidating anything.
-- ---------------------------------------------------------------------------

create or replace function public.issue_invite(
  p_circle_id uuid,
  p_secret_hash bytea
)
returns public.circle_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  issued public.circle_invites;
  revoked integer;
begin
  if caller is null then
    raise exception 'issue_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- The owner's, not any member's. Handing out the way in is the one circle
  -- decision spec §5.2 gives to the owner alone.
  if not exists (
    select 1 from public.circles c where c.id = p_circle_id and c.owner_user_id = caller
  ) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  update public.circle_invites i
  set revoked_at = now()
  where i.circle_id = p_circle_id and i.revoked_at is null;
  get diagnostics revoked = row_count;

  insert into public.circle_invites (circle_id, secret_hash, created_by)
  values (p_circle_id, p_secret_hash, caller)
  returning * into issued;

  -- Rotation is a fact the owner may need to explain later ("the old link
  -- stopped working on Tuesday"), and the count of how often links leak is
  -- worth having. Ids only.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.invite_issued', 'circle', p_circle_id,
          jsonb_build_object('invite_id', issued.id));

  -- Only when something was actually revoked. The first link a circle has is
  -- part of the circle being created, and `circles.circle_created` already says
  -- that; `circles.invite_rotated` means "the one you were given has stopped
  -- working", which is a thing to tell people and is not true here.
  if revoked > 0 then
    perform jobs.emit('circles.invite_rotated', 'circle', p_circle_id,
      jsonb_build_object('circle_id', p_circle_id));
  end if;

  return issued;
end;
$$;

comment on function public.issue_invite(uuid, bytea) is
  'Issues the circle''s invite from a digest of a secret the server never sees, revoking any earlier one. The owner''s alone; resetting the link is the same call (spec §5.2).';

revoke all on function public.issue_invite(uuid, bytea) from public;
revoke all on function public.issue_invite(uuid, bytea) from anon, authenticated;
grant execute on function public.issue_invite(uuid, bytea) to authenticated;

-- supabase/sql/functions/public/on_member_removed.sql
-- ---------------------------------------------------------------------------
-- Removal: every consequence, in one trigger.
--
-- Spec §4.5 — a removed member "loses circle and plan access immediately;
-- historic aggregate attendance may remain; their availability is deleted."
-- Four things follow, and they are here together rather than in four triggers
-- because they cannot be correct separately:
--
--   * their responses and windows go — the cascade takes the windows, and the
--     bump triggers stale every candidate set that counted them;
--   * they leave the participant list of every plan revision still open, so
--     the dispatcher stops treating them as a non-responder;
--   * a `ready` plan they had answered goes back to `collecting`, because its
--     set may have needed them for quorum, and `confirm` must not lock in a
--     time that depended on somebody who has left;
--   * on a confirmation still ahead, `going` or `unknown` becomes `cant` — a
--     `going` from them would keep them in "5 going" and on the reminder list.
--     History is untouched: answers about evenings that have happened, and
--     rows on closed confirmations, stay exactly as they were.
--
-- The circle row and then the plan rows are locked first, so a removal racing a
-- first answer cannot let the answer land behind it — and nor can a removal
-- racing a *new plan*. Locking the plans alone was not enough for that one:
-- `create_plan` reads the circle's active members and inserts its participant
-- rows in a transaction this trigger cannot see, so a removal committing in the
-- middle of it locked nothing the creation held, deleted nothing that existed
-- yet, and left the departed member on the roster of a plan created after they
-- had gone. `create_plan` takes the circle row for update for its own reasons;
-- taking the same one here is what makes the two wait for each other.
--
-- Circle before plans, which is the order `create_plan` locks in too. Two
-- transactions taking the same locks in the same order cannot deadlock over
-- them.
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

  perform 1 from public.circles c where c.id = new.circle_id for update;
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

revoke all on function public.on_member_removed() from public;
revoke all on function public.on_member_removed() from anon, authenticated;

-- supabase/sql/functions/public/reask_audience.sql
-- ---------------------------------------------------------------------------
-- Who an edit would cost, as facts. The rule that turns them into a warning is
-- `invalidatedResponses` in `packages/domain`, and there is only one of it.
--
-- Spec §5.3: an edit that invalidates responses "shows, **before saving**,
-- exactly who will be asked again". The client cannot work that out — a member
-- may read only their *own* response (`plan_responses_select_own`), which is
-- the whole point of that policy — so the server has to say. This returns the
-- two lists the domain function takes and nothing else: who the plan was
-- addressed to, and which of them have answered the revision that is current.
--
-- Not the answers themselves. Whether Priya said yes is hers; *that* she
-- answered is what the organiser is about to take away from her, and is the
-- only part of it this discloses.
--
-- Organiser-only, because `edit` is (`planning.transitions`), and a preview of
-- an edit somebody cannot make is a roster they should not have.
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

create or replace function public.reask_audience(p_plan_id uuid)
returns table (member_user_id uuid, has_responded boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan public.plans;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Organiser *and still a member*, which is the same pair `transition_plan`'s
  -- `organiser` guard checks. Comparing the id alone left a removed organiser
  -- able to call this and read every participant — "only active members see or
  -- act on it" (AGENTS.md) is a privacy invariant, and an id on a row is not
  -- membership.
  if plan.organiser_user_id is distinct from (select auth.uid())
    or not exists (
      select 1 from public.circle_members m
      where m.circle_id = plan.circle_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  -- Active members only, which matters on exactly one kind of plan: a confirmed
  -- one. `on_member_removed` clears a departed member out of open plans and
  -- keeps the rows on a confirmed one, because the confirmation's attendance is
  -- about who was there — so reopening was the case where this listed somebody
  -- who will not be asked again and could not answer if they were. Everywhere
  -- else the filter removes nothing, and "only active members" is the invariant
  -- either way.
  return query
  select pp.user_id,
    exists (
      select 1 from public.plan_responses r
      where r.plan_id = plan.id and r.revision = plan.revision and r.user_id = pp.user_id
    )
  from public.plan_participants pp
  where pp.plan_id = plan.id and pp.revision = plan.revision
    and exists (
      select 1 from public.circle_members m
      where m.circle_id = plan.circle_id and m.user_id = pp.user_id and m.status = 'active'
    )
  order by pp.user_id;
end;
$$;

comment on function public.reask_audience(uuid) is
  'The participants of a plan''s current revision and whether each has answered — the inputs invalidatedResponses() needs to say who an edit would ask again (spec §5.3). Organiser only.';

revoke all on function public.reask_audience(uuid) from public;
revoke all on function public.reask_audience(uuid) from anon, authenticated;
grant execute on function public.reask_audience(uuid) to authenticated;

-- supabase/sql/functions/public/revise_plan.sql
-- ---------------------------------------------------------------------------
-- Editing a plan, and unpicking a confirmed one.
--
-- Two lines of work and three reasons to exist. `planning.transition_plan` is in
-- `planning`, which PostgREST does not expose and which
-- `070_communication_jobs.sql` asserts no client may call. The actor has to be
-- `auth.uid()` rather than an argument — `transition_plan` takes one, because
-- SQL callers know who they are acting for, and a client-callable function that
-- did the same would let a caller name somebody else (the lesson S1-13 paid for
-- twice). And the action is fixed to the three this endpoint is for, each
-- derived from what is actually being changed: a wrapper that passed an action
-- through would let a client `confirm` or `expire` a plan without meeting the
-- checks those have endpoints for.
--
-- Everything else is `transition_plan`'s: the organiser guard, the revision
-- bump, `planning.plan_revised` or `confirmation.meetup_rescheduled`, and —
-- through `supersede_on_leaving_confirmed` — the confirmation a reopen has to
-- take with it.
-- ---------------------------------------------------------------------------

create or replace function public.revise_plan(
  p_plan_id uuid,
  p_reopen boolean default false,
  p_payload jsonb default '{}'::jsonb,
  -- Null means "leave them alone". An empty array means nobody is required,
  -- which is a different answer and is kept as one — the same distinction
  -- `create_plan` draws.
  p_required_member_ids uuid[] default null,
  -- What the preview said the plan was. Null means the caller did not preview.
  p_expected_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  revised public.plans;
  audience jsonb;
  action text;
  key text;
  effective_deadline timestamptz;
  wanted uuid[];
begin
  if caller is null then
    raise exception 'revise_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- The lock, and then the audience, and then the change — all three in this
  -- transaction, which is the whole point of doing it here.
  --
  -- The handler used to ask `reask_audience` over HTTP and then call this, and
  -- an answer submitted between the two calls was cleared by the revision bump
  -- while being reported to the organiser as somebody who had *not* answered.
  -- The warning was then wrong about the one person it was most about.
  -- `replace_response` takes this same row lock, so holding it here means a
  -- concurrent answer either lands before we read the audience or waits and
  -- then finds its revision stale.
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Under the lock, before anything is read or written: the warning the
  -- organiser agreed to was about a particular version of this plan, and an
  -- answer arriving since has moved it. §5.3 promises the cost is shown
  -- *before* saving, and a save that costs more than the preview said breaks
  -- that promise however accurately it reports itself afterwards. The same
  -- argument `replace_response` makes about answering a question that has
  -- changed, one level up.
  if p_expected_version is not null
    and p_expected_version is distinct from (plan.revision || '.' || plan.input_version)
  then
    raise exception 'preview_is_stale' using errcode = 'P0001';
  end if;

  -- Through `reask_audience` rather than a second copy of its query: the
  -- preview and the save have to answer the same question the same way, and
  -- two queries that agree today are two queries that can stop agreeing. Its
  -- organiser check runs first as a result, which is the same refusal
  -- `transition_plan`'s guard would raise a moment later.
  select coalesce(jsonb_agg(to_jsonb(a) order by a.member_user_id), '[]'::jsonb)
  into audience
  from public.reask_audience(p_plan_id) a;

  -- Who may be required: the people this revision was addressed to, not every
  -- active member. `replace_response` refuses a non-participant, so requiring
  -- somebody who joined the circle after the plan was created — and who spec §9
  -- deliberately did not add to it — made the plan permanently ineligible with
  -- no way for that person to fix it. Checked before the transition, and an
  -- error rather than a silent drop: an organiser who names five people and
  -- gets four required has been told nothing.
  if p_required_member_ids is not null and exists (
    select 1 from unnest(p_required_member_ids) as required
    where not exists (
      select 1 from public.plan_participants pp
      where pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = required
    )
  ) then
    raise exception 'not_a_participant' using errcode = 'P0001';
  end if;

  -- Sent is not changed, decided here rather than only in the Edge Function.
  -- This function is `grant execute … to authenticated`, so "the handler
  -- compares the values first" is a rule the authoritative layer does not hold
  -- (AGENTS.md §6.4) and a client going straight to PostgREST does not obey: a
  -- form resubmitted unedited emitted `planning.plan_revised` to the whole
  -- circle, and a quorum that had not moved threw away a candidate set and
  -- dropped a `ready` plan to `collecting`. A json null is the same no-op
  -- wearing a value: `coalesce` in the update leaves the column alone while the
  -- key makes the payload look like a change.
  p_payload := coalesce(p_payload, '{}'::jsonb);
  foreach key in array array['window_start', 'window_end', 'daily_start_local',
    'daily_end_local', 'duration_minutes', 'quorum', 'response_deadline']
  loop
    if p_payload ? key and (
      jsonb_typeof(p_payload -> key) = 'null'
      or (key = 'window_start' and (p_payload ->> key)::date = plan.window_start)
      or (key = 'window_end' and (p_payload ->> key)::date = plan.window_end)
      or (key = 'daily_start_local' and (p_payload ->> key)::integer = plan.daily_start_local)
      or (key = 'daily_end_local' and (p_payload ->> key)::integer = plan.daily_end_local)
      or (key = 'duration_minutes' and (p_payload ->> key)::integer = plan.duration_minutes)
      or (key = 'quorum' and (p_payload ->> key)::integer = plan.quorum)
      or (key = 'response_deadline'
          and (p_payload ->> key)::timestamptz = plan.response_deadline)
    ) then
      p_payload := p_payload - key;
    end if;
  end loop;

  -- The same question of the required list, and the same answer: a list that
  -- matches the one the plan has is not a change, and rewriting the identical
  -- rows would stale the candidate set for nothing.
  if p_required_member_ids is not null then
    select coalesce(array_agg(distinct u order by u), array[]::uuid[]) into wanted
    from unnest(p_required_member_ids) as u;
    if wanted = (
      select coalesce(array_agg(rm.user_id order by rm.user_id), array[]::uuid[])
      from public.plan_required_members rm
      where rm.plan_id = plan.id and rm.revision = plan.revision
    ) then
      p_required_member_ids := null;
    else
      p_required_member_ids := wanted;
    end if;
  end if;

  if p_payload = '{}'::jsonb and p_required_member_ids is null and not p_reopen then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;

  -- Which action this is, from what is being changed rather than from what the
  -- caller says it is. A payload touching the window, the band or the duration
  -- changes *the question* and earns a new revision; one touching only the
  -- quorum or the deadline changes what happens to the answers and must not
  -- (spec §5.3).
  --
  -- Derived here, not passed in, so a client cannot ask for the cheap action and
  -- the expensive change. It could not get far if it tried —
  -- `planning.allowed_keys('adjust')` is those two keys alone — but the caller
  -- having no say is simpler than the caller being caught.
  action := case
    when p_reopen then 'reopen'
    when p_payload ?| array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local', 'duration_minutes'
    ] then 'edit'
    else 'adjust'
  end;

  -- The end of the deadline rule the table cannot check. `plans_deadline` bounds
  -- it above — never after the last possible start — and "not already past" is
  -- not a constraint a table can hold, because it is about now.
  --
  -- Judged on the deadline the plan would be left with, and only for the actions
  -- that ask everybody again: a new revision clears the answers and
  -- `replace_response` refuses a reply once the deadline has gone, so a reopen
  -- into a passed deadline produced a plan that announced a fresh ask nobody was
  -- allowed to answer. An `adjust` leaves the answers where they are, and §5.7's
  -- "give it one more day" is for exactly the plan whose deadline has passed.
  effective_deadline := coalesce(
    (p_payload ->> 'response_deadline')::timestamptz, plan.response_deadline);
  if (action in ('edit', 'reopen') or p_payload ? 'response_deadline')
    and effective_deadline <= now()
  then
    raise exception 'deadline_out_of_range' using errcode = 'P0001';
  end if;

  revised := planning.transition_plan(p_plan_id, action, caller, p_payload);

  -- Who has to be there, if the organiser said. Spec §9's answer to "a required
  -- person leaves" is that "the plan becomes ineligible until the organiser
  -- changes required members or cancels" — so there had to be a way to change
  -- them, and there was none.
  --
  -- Not a revision: it does not change what anybody was asked, so nobody answers
  -- again. It *does* change which times are eligible, so the candidate set has to
  -- be recomputed for the same reason a quorum change does — and after the
  -- transition, so that the rows land on the revision the plan is on now.
  if p_required_member_ids is not null then
    delete from public.plan_required_members rm
    where rm.plan_id = revised.id and rm.revision = revised.revision;

    insert into public.plan_required_members (plan_id, revision, user_id)
    select distinct revised.id, revised.revision, required
    from unnest(p_required_member_ids) as required;

    update public.plans p
    set input_version = p.input_version + 1
    where p.id = revised.id
    returning * into revised;
  end if;

  -- A stale set is not a set. Bumping `input_version` says "recompute" to the
  -- engine, and says nothing at all to a plan sitting in `ready`:
  -- `candidate_is_eligible` checks the versions, so `confirm` would refuse the
  -- displayed candidates while every state-driven screen still read "ready" —
  -- the same trap `replace_response` avoids by firing `candidates_gone` when an
  -- answer moves. Quorum and required members both change which times qualify,
  -- so both do it here; a deadline-only adjustment changes neither and leaves a
  -- ready plan ready (ADR 0017). `candidates_gone` has no guards and no event:
  -- nobody is told the set is being recomputed, because nobody was told it
  -- existed.
  if revised.state = 'ready' and (p_payload ? 'quorum' or p_required_member_ids is not null) then
    revised := planning.transition_plan(revised.id, 'candidates_gone', caller);
  end if;

  -- The plan *and* the audience it had when this transaction began. Two values,
  -- so one object: the handler needs the new revision to report and the old
  -- audience to warn about, and computing the second anywhere else reintroduces
  -- the gap this function was given the lock to close.
  return jsonb_build_object(
    'plan', to_jsonb(revised),
    'audience', audience,
    -- The version the audience was read at, which is the version this answer
    -- describes — not the one the change has just produced.
    'version', plan.revision || '.' || plan.input_version
  );
end;
$$;

comment on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) is
  'Edits a plan, or reopens a confirmed one, as the calling organiser. Returns the revised plan and the audience it had before the change, derived under the same lock. A fixed set of actions over planning.transition_plan, which no client can call.';

revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) from public;
revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) from anon, authenticated;
grant execute on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) to authenticated;

-- END GENERATED: function definitions
