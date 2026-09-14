-- ---------------------------------------------------------------------------
-- Storing what the engine found, if it is still about this plan.
--
-- The whole of the ticket's "stale-result protection" is the comparison below.
-- A recalculation reads the plan, runs the engine, and comes back to write —
-- and in between, somebody can answer. Their answer bumps `input_version`, and
-- the set in hand was computed without it: storing it would show the circle a
-- set of times that does not include what the last person said, and `confirm`
-- would lock one in. So the version the engine read is passed back here and
-- compared under the plan's row lock. If it has moved, nothing is written and
-- the answer that moved it has a recalculation of its own coming.
--
-- Not an error. A discarded result is the mechanism working: the caller is told
-- `stored: false` and the state as it actually is, and nobody retries anything.
--
-- The transitions belong here for the same reason the write does. "Eligible
-- appears" and "eligible disappears" are facts about the set being stored, and
-- a plan that said `ready` while its set said nothing is the exact trap
-- `candidate_is_eligible` cannot see past: `confirm` would refuse the times the
-- screen was showing. One transaction: the set, the state and the event.
--
-- In `public` because PostgREST exposes nothing else, and granted to
-- `service_role` alone — no member may write a candidate set, and the engine is
-- not a person.
-- ---------------------------------------------------------------------------

create or replace function public.store_candidate_set(
  p_plan_id uuid,
  -- What the engine read. Not what it is now — that is the point.
  p_input_version integer,
  p_revision integer,
  -- One `CandidateSet` from `packages/domain/scheduling`, as JSON, with its
  -- instants as ISO strings. That conversion is the whole of what the Edge
  -- Function does to it, and it happens there because that is where the
  -- boundary between the two honest representations lives (`_shared/moment.ts`):
  -- the domain counts milliseconds, the wire and Postgres read ISO 8601.
  p_set jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  set_id uuid;
  eligible_count integer := coalesce((p_set -> 'stats' ->> 'eligibleCount')::integer, 0);
  near_miss_count integer := coalesce(jsonb_array_length(p_set -> 'nearMisses'), 0);
  had_options boolean;
  was_ready boolean;
begin
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Stale, in either of the two ways a plan moves: an answer changed
  -- (`input_version`) or the question did (`revision`). A revision bump makes
  -- the whole set meaningless rather than merely out of date — it was computed
  -- from answers that no longer belong to the plan at all.
  --
  -- A plan that has been confirmed, cancelled or expired is stale in the third
  -- way: there is nothing left to recalculate, and `candidates_ready` does not
  -- exist from those states.
  if plan.input_version <> p_input_version
    or plan.revision <> p_revision
    or plan.state not in ('collecting', 'ready')
  then
    -- Told what is, not what was computed. The caller reports this to a screen,
    -- and "the recalculation you asked for was thrown away" is not an answer a
    -- person can read — "here is the plan, and here is the set it currently
    -- has" is, and it stays true whichever branch produced it.
    return public.candidate_summary(plan, false);
  end if;

  -- The third way a result can be about a plan that has changed, and the one a
  -- version cannot see. `private.move_membership` — a reattachment, or a guest
  -- claiming a saved place — rewrites `plan_responses.user_id`,
  -- `plan_participants.user_id` and the ids inside existing `candidates` rows,
  -- and it deliberately does *not* bump `input_version`: nothing about the
  -- answers changed, only whose they are. A result computed before that move and
  -- stored after it passes the version check and writes the old id into a fresh
  -- set — after which `confirm` freezes that id into the confirmation and marks
  -- the person, who is available and present, as `cant`.
  --
  -- So the set has to be about people the plan is currently asking. That is a
  -- stronger statement than "the versions match" and subsumes it for this case:
  -- an id that is not a participant of this revision is either somebody who left,
  -- somebody who was never asked, or somebody whose membership moved while the
  -- engine was running.
  if exists (
    select 1
    from jsonb_array_elements(
      coalesce(p_set -> 'eligible', '[]'::jsonb) || coalesce(p_set -> 'nearMisses', '[]'::jsonb)
    ) as item
    cross join lateral jsonb_array_elements_text(item.value -> 'availableUserIds') as named(user_id)
    where not exists (
      select 1 from public.plan_participants pp
      where pp.plan_id = plan.id
        and pp.revision = plan.revision
        and pp.user_id = named.user_id::uuid
    )
  ) then
    return public.candidate_summary(plan, false);
  end if;

  -- What the plan knew a moment ago, read before the delete takes it away. Both
  -- halves of "did options disappear?" — the state, and the set the state was
  -- derived from — because a plan can hold a set with options while sitting in
  -- `collecting`, between a recalculation and the transition that follows it.
  select cs.eligible_count > 0 into had_options
  from public.candidate_sets cs
  where cs.plan_id = plan.id and cs.revision = plan.revision
  order by cs.input_version desc
  limit 1;
  was_ready := plan.state = 'ready';

  -- One live set for the revision being recalculated — earlier revisions keep
  -- theirs, which is bounded by how many times a plan has been edited and is
  -- what a confirmation on an earlier revision was chosen from. Within this
  -- revision, an older set is not history anybody reads:
  -- `candidate_is_eligible` matches on the plan's current versions and ignores
  -- everything else, the screens read the current set, and a confirmation keeps
  -- its own frozen copy of the time it locked in. Keeping them would add a row
  -- per answer per plan for ever.
  delete from public.candidate_sets cs
  where cs.plan_id = plan.id and cs.revision = plan.revision;

  insert into public.candidate_sets (
    plan_id, revision, input_version, scoring_version, input_hash,
    starts_considered, eligible_count, responded_count, active_member_count
  )
  values (
    plan.id, plan.revision, plan.input_version,
    (p_set ->> 'scoringVersion')::integer,
    p_set ->> 'inputHash',
    (p_set -> 'stats' ->> 'startsConsidered')::integer,
    eligible_count,
    (p_set -> 'stats' ->> 'respondedCount')::integer,
    (p_set -> 'stats' ->> 'activeMemberCount')::integer
  )
  returning id into set_id;

  -- Options and near-misses share a table and a shape, and are ranked
  -- separately: `ordinality` is the engine's order, which is the ranking.
  insert into public.candidates (
    candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
    explicit_count, flexible_count, explanation_code, explanation_count, near_miss_reason
  )
  select
    set_id,
    kind.is_near_miss,
    row_number() over (partition by kind.is_near_miss order by item.ordinality)::integer,
    (item.value ->> 'start')::timestamptz,
    (item.value ->> 'end')::timestamptz,
    (
      select coalesce(array_agg(u::uuid order by ord), array[]::uuid[])
      from jsonb_array_elements_text(item.value -> 'availableUserIds') with ordinality as a(u, ord)
    ),
    (item.value ->> 'explicitCount')::integer,
    (item.value ->> 'flexibleCount')::integer,
    item.value -> 'explanation' ->> 'code',
    (item.value -> 'explanation' ->> 'count')::integer,
    case when kind.is_near_miss then item.value -> 'reason' else null end
  from (values (false, 'eligible'), (true, 'nearMisses')) as kind(is_near_miss, field)
  cross join lateral jsonb_array_elements(coalesce(p_set -> kind.field, '[]'::jsonb))
    with ordinality as item(value, ordinality);

  -- And the plan's scoring version follows the set's, which is a landmine
  -- rather than a nicety. `planning.candidate_is_eligible` requires
  -- `cs.scoring_version = plan.scoring_version`, `plans.scoring_version`
  -- defaults to 1, and until this function existed nothing had ever written a
  -- set at all — so the day the engine's `SCORING_VERSION` becomes 2, every new
  -- set would have been stored with 2 against plans still saying 1, and
  -- `confirm` would have refused every candidate on every plan, silently, with
  -- the screen still showing them. 0003 granted the service role
  -- `update (input_version, scoring_version)` for this; nothing had used it.
  --
  -- A set that has just been computed *is* the version the plan is scored by.
  -- The comparison keeps its meaning — a candidate has to come from the set the
  -- plan currently holds — and stops being a trap.
  if plan.scoring_version is distinct from (p_set ->> 'scoringVersion')::integer then
    update public.plans p
    set scoring_version = (p_set ->> 'scoringVersion')::integer
    where p.id = plan.id
    returning * into plan;
  end if;

  -- The state follows the set. `candidates_ready` announces
  -- `scheduling.candidates_generated` through `planning.event_for`;
  -- `candidates_gone` announces nothing, because "the set is stale" is not news
  -- — which is why the disappearance is announced below instead, from what was
  -- actually found.
  if eligible_count > 0 and plan.state = 'collecting' then
    plan := planning.transition_plan(plan.id, 'candidates_ready', null);
  elsif eligible_count = 0 and plan.state = 'ready' then
    plan := planning.transition_plan(plan.id, 'candidates_gone', null);
  end if;

  -- Only when options that existed are gone. A plan that has never had one is
  -- not having anything taken away — it is collecting, and the screen says so
  -- (spec §5.6: "members see nothing until options exist"). Announcing every
  -- empty recalculation would be one event per answer per plan, all of them
  -- saying the same thing about a plan nobody has been promised anything about.
  if eligible_count = 0 and (was_ready or coalesce(had_options, false)) then
    perform jobs.emit(
      'scheduling.no_eligible_candidates', 'plan', plan.id,
      jsonb_build_object(
        'plan_id', plan.id,
        'circle_id', plan.circle_id,
        'revision', plan.revision,
        'near_miss_count', near_miss_count
      )
    );
  end if;

  return public.candidate_summary(plan, true);
end;
$$;

comment on function public.store_candidate_set(uuid, integer, integer, jsonb) is
  'Stores one engine result against the plan, but only if the plan is still at the version the engine read; moves the plan between collecting and ready and announces options that have gone. Service role only.';

revoke all on function public.store_candidate_set(uuid, integer, integer, jsonb) from public;
revoke all on function public.store_candidate_set(uuid, integer, integer, jsonb) from anon, authenticated;
grant execute on function public.store_candidate_set(uuid, integer, integer, jsonb) to service_role;
