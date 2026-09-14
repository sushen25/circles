-- ---------------------------------------------------------------------------
-- 0013 — locking a time in, and saying afterwards what became of it (S1-17).
--
-- One new function and one corrected pair of refusals. No new tables:
-- `meetup_confirmations`, `attendance` and `outcome_reports` have been there
-- since 0005, and `planning.transition_plan` has written the confirmation and
-- derived the attendance since 0011.
--
--   `public.confirm_meetup`   the organiser's wrapper over that transition
--
-- What the wrapper adds is the one distinction the machine cannot make.
-- `planning.candidate_is_eligible` answers a single boolean for four different
-- situations — an older revision, a set computed before somebody's answer, a
-- different engine, or an id that is simply not on offer — and
-- `transition_plan` turns all four into `needs_candidate`. The first three mean
-- "your screen is out of date"; the last means "that is not one of the options".
-- A client that cannot tell them apart tells the organiser the wrong thing.
--
-- `public.report_outcome` is redefined unchanged in behaviour: its refusals now
-- raise the names `_shared/problem.ts` maps to a `ProblemReason`, so a member
-- who taps "did it happen?" on somebody else's meetup gets a 403 that says so
-- rather than a 500.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/confirm_meetup.sql
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

-- supabase/sql/functions/public/confirmation_evidence.sql
-- ---------------------------------------------------------------------------
-- What became of a meetup, in numbers rather than names.
--
-- `attendance_select_member` shows a **retrospective** answer only to the person
-- who gave it: "nobody is scored and nobody is told who came" (spec §5.10) is a
-- policy, not a copy decision. Which means the organiser — the one person who
-- needs to know whether their report was corroborated — cannot see the
-- `was_there` rows that would corroborate it, and neither can the endpoint
-- reading through their session.
--
-- So the counting happens here, where a definer function can see the rows, and
-- what comes back has no identity in it at all: how many said they were there,
-- how many said they missed it, and the one comparison the corroboration rule
-- needs — whether anybody *other than the reporter* said they were there
-- (§11.1: "corroborated happened" = at least one other member confirms).
--
-- The rule itself is not here. `corroborationOf` in `packages/domain` turns
-- these facts into the word, because the metric and the screen have to agree
-- about what corroboration means and a second copy of that is how they stop.
-- ---------------------------------------------------------------------------

create or replace function public.confirmation_evidence(p_confirmation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  confirmation public.meetup_confirmations;
  circle uuid;
  reporter uuid;
  reported text;
begin
  select * into confirmation
  from public.meetup_confirmations c where c.id = p_confirmation_id;
  if not found then
    raise exception 'confirmation_not_found' using errcode = 'P0001';
  end if;

  select p.circle_id into circle from public.plans p where p.id = confirmation.plan_id;

  -- Definer, so RLS is not answering: the membership question has to be asked
  -- out loud. Only active members of the circle see any of this (§8.2), and a
  -- non-member gets the same answer as a confirmation that is not there.
  if not public.auth_is_member(circle) then
    raise exception 'confirmation_not_found' using errcode = 'P0001';
  end if;

  select r.reported_by, r.outcome into reporter, reported
  from public.outcome_reports r
  where r.confirmation_id = p_confirmation_id
  order by r.reported_at
  limit 1;

  return jsonb_build_object(
    'outcome', reported,
    'was_there', (
      select count(*) from public.attendance a
      where a.confirmation_id = p_confirmation_id and a.status = 'was_there'
    ),
    'missed', (
      select count(*) from public.attendance a
      where a.confirmation_id = p_confirmation_id and a.status = 'missed'
    ),
    -- The one comparison, made here because it needs the ids and returns none
    -- of them. False when nobody has reported: there is no reporter to be
    -- "other than" yet.
    'someone_else_was_there', coalesce((
      select exists (
        select 1 from public.attendance a
        where a.confirmation_id = p_confirmation_id
          and a.status = 'was_there'
          and a.user_id is distinct from reporter
      ) and reporter is not null
    ), false)
  );
end;
$$;

comment on function public.confirmation_evidence(uuid) is
  'How many said they were there or missed it, and whether anybody other than the reporter did — counts only, never identities. For members of the circle.';

revoke all on function public.confirmation_evidence(uuid) from public;
revoke all on function public.confirmation_evidence(uuid) from anon;
grant execute on function public.confirmation_evidence(uuid) to authenticated;

-- supabase/sql/functions/public/report_outcome.sql
-- The one way a client reports an outcome (architecture §8.4: attendance is
-- the only confirmation table a member writes directly). The actor is
-- `auth.uid()`, never a parameter, and `reported_at` is the server's clock.
-- The organiser check here is the cheap, early one; the one that counts —
-- organiser *and still a member* — is `transition_plan`'s, reached through the
-- trigger, and it is not duplicated.
--
-- **It is idempotent**, because AGENTS.md says transitions are and because this
-- one is tapped on a phone the morning after a catch-up: a retry whose first
-- attempt committed but whose answer was lost must not report failure for
-- something that worked, or the organiser will sensibly try again. So a second
-- call with the same answer — the same payload, field for field, a null `note`
-- included — returns the report the first one wrote; the
-- insert does not happen, so `apply_outcome` does not fire, so nothing is
-- recorded or announced twice. A second call with a *different* answer is not
-- a retry but a change of mind, and there is no way to take an outcome back:
-- it is refused, and says so.

create or replace function public.report_outcome(
  p_confirmation_id uuid,
  p_outcome text,
  p_note text default null,
  p_moved_outside boolean default null
)
returns public.outcome_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  organiser uuid;
  circle uuid;
  report public.outcome_reports;
begin
  if actor is null then
    raise exception 'report_outcome requires a signed-in actor' using errcode = 'insufficient_privilege';
  end if;

  select p.organiser_user_id, p.circle_id into organiser, circle
  from public.meetup_confirmations c
  join public.plans p on p.id = c.plan_id
  where c.id = p_confirmation_id;

  -- By name, because `_shared/problem.ts` turns an exception's text into a
  -- `ProblemReason` by exact match: a sentence matches nothing, so the endpoint
  -- answered 500 for an ordinary "this is not yours to answer".
  if organiser is null then
    raise exception 'confirmation_not_found' using errcode = 'no_data_found';
  end if;
  if organiser is distinct from actor then
    raise exception 'not_the_organiser' using errcode = 'insufficient_privilege';
  end if;

  insert into public.outcome_reports (confirmation_id, reported_by, outcome, note, moved_outside)
  values (p_confirmation_id, actor, p_outcome, p_note, p_moved_outside)
  on conflict (confirmation_id, reported_by) do nothing
  returning * into report;

  if report.id is not null then
    return report;
  end if;

  -- The conflict: this organiser has already answered for this confirmation.
  --
  -- This is the one branch that *returns* a row rather than writing one, so it
  -- is the one branch that has to ask about membership. A first call never gets
  -- this far without `transition_plan` agreeing the actor is a member, but a
  -- replay skips it — and `outcome_reports_select_member` would not show this
  -- row to somebody who has left the circle, so neither will this.
  -- The same refusal a first call would have met. `transition_plan`'s organiser
  -- guard means "the organiser, and still a member", and raises this; a replay
  -- never reaches it. Two codes for one situation would let the client's
  -- behaviour turn on whether the first attempt's answer was lost.
  if not public.auth_is_member(circle) then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  select * into report from public.outcome_reports r
  where r.confirmation_id = p_confirmation_id and r.reported_by = actor;

  if report.outcome is distinct from p_outcome
     or report.note is distinct from p_note
     or report.moved_outside is distinct from p_moved_outside then
    raise exception 'outcome_already_reported' using errcode = 'check_violation';
  end if;

  return report;
end;
$$;

comment on function public.report_outcome(uuid, text, text, boolean) is
  'The organiser''s answer to "did this catch-up happen?". The only client write path to outcome_reports; the insert trigger does the rest.';

grant execute on function public.report_outcome(uuid, text, text, boolean) to authenticated;
revoke all on function public.report_outcome(uuid, text, text, boolean) from public;
revoke all on function public.report_outcome(uuid, text, text, boolean) from anon;

-- END GENERATED: function definitions
