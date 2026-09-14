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
  ('collecting', 'cancel', 'cancelled', array['organiser'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'adjust', 'ready', array['organiser'], false),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('ready', 'expire', 'expired', array[]::text[], false),
  ('ready', 'cancel', 'cancelled', array['organiser'], false),
  ('confirmed', 'reopen', 'collecting', array['organiser'], true),
  ('confirmed', 'cancel', 'cancelled', array['organiser'], false),
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
    when 'cancel' then case p_from_state
      when 'confirmed' then 'confirmation.meetup_cancelled'
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
  -- added to it by the organiser fixing a date. Anyone who has left is dropped,
  -- because `on_member_removed` already took them out of the revision they were
  -- in and there is nothing to carry.
  if rule.bumps_revision then
    insert into public.plan_participants (plan_id, revision, user_id, joined_at)
    select plan.id, plan.revision, pp.user_id, pp.joined_at
    from public.plan_participants pp
    where pp.plan_id = plan.id and pp.revision = plan.revision - 1;

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
  -- walks the table so a new row cannot arrive without one. The one silence is
  -- named here and there: `candidates_gone`, see `event_for`.
  event_name := planning.event_for(rule.from_state, p_action);
  if event_name is null and p_action not in ('candidates_gone') then
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
  insert into public.plan_required_members (plan_id, revision, user_id)
  select created.id, created.revision, required
  from unnest(coalesce(p_required_member_ids, array[caller])) as required
  where exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = required and m.status = 'active'
  );

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
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
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

  return query
  select pp.user_id,
    exists (
      select 1 from public.plan_responses r
      where r.plan_id = plan.id and r.revision = plan.revision and r.user_id = pp.user_id
    )
  from public.plan_participants pp
  where pp.plan_id = plan.id and pp.revision = plan.revision
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
-- twice). And the action is fixed to the two this endpoint is for: a wrapper
-- that passed an action through would let a client `confirm` or `expire` a plan
-- without meeting the checks those have endpoints for.
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
  p_required_member_ids uuid[] default null
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  revised public.plans;
begin
  if caller is null then
    raise exception 'revise_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
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
  revised := planning.transition_plan(
    p_plan_id,
    case
      when p_reopen then 'reopen'
      when coalesce(p_payload, '{}'::jsonb) ?| array[
        'window_start', 'window_end', 'daily_start_local', 'daily_end_local', 'duration_minutes'
      ] then 'edit'
      else 'adjust'
    end,
    caller,
    coalesce(p_payload, '{}'::jsonb)
  );

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
    select revised.id, revised.revision, required
    from unnest(p_required_member_ids) as required
    where exists (
      select 1 from public.circle_members m
      where m.circle_id = revised.circle_id and m.user_id = required and m.status = 'active'
    );

    update public.plans p
    set input_version = p.input_version + 1
    where p.id = revised.id
    returning * into revised;
  end if;

  return revised;
end;
$$;

comment on function public.revise_plan(uuid, boolean, jsonb, uuid[]) is
  'Edits a plan, or reopens a confirmed one, as the calling organiser. A fixed pair of actions over planning.transition_plan, which no client can call.';

revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[]) from public;
revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[]) from anon, authenticated;
grant execute on function public.revise_plan(uuid, boolean, jsonb, uuid[]) to authenticated;

-- END GENERATED: function definitions
