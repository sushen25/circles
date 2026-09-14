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
