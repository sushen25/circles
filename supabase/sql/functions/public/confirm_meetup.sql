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
--
-- And "current" is measured against the set the *organiser* was shown, whose id
-- they send, rather than against whatever is current by the time the tap
-- arrives. An answer landing while the review screen is open recalculates
-- inline (ADR 0018): there is a new current set, the chosen time may still be
-- eligible in it, and confirming would freeze an availability list nobody
-- looked at.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_meetup(
  p_plan_id uuid,
  -- The ISO start of the chosen candidate. A candidate's identity is its time
  -- (`candidateIdOf`), because the set is recomputed whenever anybody answers.
  p_candidate_id text,
  -- **The candidate set the organiser was looking at**, by its id. Not optional:
  -- "load the current candidate set and check the candidate belongs to it"
  -- (architecture §9.1) is a question about *which* set was on the screen, and a
  -- caller who cannot say has not made the check — they have skipped it.
  --
  -- The id rather than a version token, which an earlier draft used. A set is
  -- replaced when the revision moves, when an answer moves the input version,
  -- *and* when the engine's scoring version changes — and that last one leaves
  -- `<revision>.<input_version>` identical, so a token made of those two
  -- accepted a set the organiser had never seen. The id is the one thing that
  -- changes whenever the set does.
  p_expected_set_id uuid,
  -- "Did you have to chase anyone outside the app?" (spec §5.10). Required
  -- here as well as in the request schema: this function is granted to
  -- `authenticated`, so a client going straight to PostgREST is a client the
  -- schema never saw, and the evidence for H2 is not optional because of the
  -- door somebody came through. Ahead of the optional details for the ordinary
  -- reason — a parameter with no default cannot follow one that has it.
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
    raise exception 'confirm_meetup requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  -- Membership before anything else that can be observed. This function is
  -- `security definer` and callable by anybody signed in, so every refusal after
  -- this point is an answer about a plan — that it exists, which version it is
  -- at, whether its set is current. "Only active members see or act on it"
  -- (AGENTS.md) is structural, and a refusal is a way of seeing.
  --
  -- A non-member gets the same answer as a plan that is not there, deliberately:
  -- telling them apart would confirm the id.
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- A member may know their plan has an organiser who is not them. The cheap,
  -- early one; `transition_plan`'s guard is the one that counts, and it also
  -- re-checks membership.
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if p_chased_answer is null or p_chased_answer not in ('none', 'one', 'more') then
    raise exception 'chased_answer_required' using errcode = 'P0001';
  end if;

  -- **The set the organiser was looking at**, not merely a set that is current.
  --
  -- Asking "is there a current set?" was not the freshness check it looked
  -- like. An answer landing while the review screen is open recalculates
  -- inline (ADR 0018), so by the time the organiser taps there is a *new*
  -- current set — and if the time they chose is still eligible in it, the
  -- confirmation freezes an availability list they never saw. Somebody who
  -- withdrew appears on the card; somebody who just answered does not.
  --
  -- So the caller says which set they were shown, and it is compared here,
  -- under the lock, against the one that is current for the plan. One
  -- comparison covers every way a set can be replaced — a new revision, a new
  -- answer, a new engine — and covers the case where the plan has moved to a
  -- version whose recalculation has not landed, because then there is no
  -- current set and nothing to match.
  -- Null first and on its own: a caller who names no set was not looking at
  -- one, and `null is distinct from null` is false — so a plan whose
  -- recalculation has not landed would have matched a request that named
  -- nothing, and the check would have passed by both sides being absent.
  if p_expected_set_id is null then
    raise exception 'stale_candidates' using errcode = 'P0001';
  end if;

  if p_expected_set_id is distinct from (
    select cs.id from public.candidate_sets cs
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

comment on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) is
  'Locks in a candidate as the calling organiser, through planning.transition_plan, and distinguishes a stale candidate set from a candidate that is not on offer.';

revoke all on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) from public;
revoke all on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) from anon, authenticated;
grant execute on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) to authenticated;
