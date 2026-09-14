-- ---------------------------------------------------------------------------
-- Locking a time in.
--
-- A wrapper over `planning.transition_plan(plan, 'confirm', …)`, which already
-- does all of the work: the organiser guard, the eligibility check, the frozen
-- confirmation row, the derived attendance and the event, in one transaction.
-- The wrapper exists for the reasons `cancel_plan`'s does — `planning` is not
-- reachable by a client, and the actor must be `auth.uid()` rather than an
-- argument — and for one of its own, which is the whole of the code below the
-- lock.
--
-- **Telling a stale screen from a wrong choice.** `candidate_is_eligible`
-- answers one boolean for four different situations: the set is for an older
-- revision, it was computed before somebody's answer, it came from a different
-- engine, or the id is simply not one of the times on offer. `transition_plan`
-- turns all four into `needs_candidate` — and the first three mean "your screen
-- is out of date, fetch it again", while the last means "that is not one of the
-- options". A client that cannot tell them apart either refetches when it need
-- not or, worse, shows "that time is gone" to an organiser whose screen was
-- right a second ago.
--
-- So the staleness is compared here, ahead of the guard, and raised as
-- `stale_candidates`. What reaches `needs_candidate` afterwards is then true:
-- the set is current and the id is not in it.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_meetup(
  p_plan_id uuid,
  -- The ISO start of the chosen candidate. A candidate's identity is its time
  -- (`candidateIdOf`), because the set is recomputed whenever anybody answers.
  p_candidate_id text,
  p_place_name text default null,
  p_place_url text default null,
  p_note text default null,
  -- "Did you have to chase anyone outside the app?" (spec §5.10).
  p_chased_answer text default null
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
    raise exception 'confirm_meetup requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Is there a set for this plan as it stands? The three versions are the three
  -- ways it can have moved since the organiser looked: a new revision (the
  -- question changed), a new input version (somebody answered), a new scoring
  -- version (the engine changed). `planning.candidate_is_eligible` compares the
  -- same three — this is the same test, asked so that the answer can be a
  -- reason rather than a boolean.
  if not exists (
    select 1 from public.candidate_sets cs
    where cs.plan_id = plan.id
      and cs.revision = plan.revision
      and cs.input_version = plan.input_version
      and cs.scoring_version = plan.scoring_version
  ) then
    raise exception 'stale_candidates' using errcode = 'P0001';
  end if;

  -- And the rest is the machine's. The organiser guard, `candidate_is_eligible`
  -- against the set, the passed-time check, the frozen row, the attendance and
  -- `confirmation.meetup_confirmed` all happen in there, where the plan row is
  -- already locked by the statement above.
  perform planning.transition_plan(
    p_plan_id,
    'confirm',
    caller,
    jsonb_strip_nulls(jsonb_build_object(
      'candidate_id', p_candidate_id,
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

comment on function public.confirm_meetup(uuid, text, text, text, text, text) is
  'Locks in a candidate as the calling organiser, through planning.transition_plan, and distinguishes a stale candidate set from a candidate that is not on offer.';

revoke all on function public.confirm_meetup(uuid, text, text, text, text, text) from public;
revoke all on function public.confirm_meetup(uuid, text, text, text, text, text) from anon, authenticated;
grant execute on function public.confirm_meetup(uuid, text, text, text, text, text) to authenticated;
