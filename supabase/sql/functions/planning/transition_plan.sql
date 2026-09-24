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
        -- One open plan per circle (spec §5.3, ADR 00XX): a second plan raised
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
