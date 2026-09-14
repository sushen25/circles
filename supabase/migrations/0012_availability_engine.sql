-- ---------------------------------------------------------------------------
-- 0012 — the candidate engine's two ends (S1-16).
--
-- No new tables. `candidate_sets`, `candidates`, `plan_responses` and
-- `willing_windows` have been there since 0004; what was missing was the pair of
-- functions that read a plan into the engine and write what it found back:
--
--   `public.engine_input`         one snapshot of plan, roster and answers
--   `public.store_candidate_set`  the compare-and-set that makes a stale result harmless
--   `public.candidate_summary`    where a plan stands, in the screen's three words
--
-- All three in `public`, which is not where they belong conceptually but is the
-- only schema PostgREST exposes, and all three granted to `service_role` alone.
-- That is the difference from the plan lifecycle's functions: those act for a
-- signed-in person and check `auth.uid()`, while these act for the engine, which
-- is not a person and has no circle. A member may read the *result* — `candidates`
-- is readable under RLS by the circle — and may not read the input, which is
-- every member's answer (spec §5.5: "your friends will only see a combined
-- result").
--
-- `public.replace_response` is redefined here too, unchanged in behaviour: its
-- refusals now raise the names `_shared/problem.ts` maps to a `ProblemReason`,
-- with the numbers that used to be in the message moved to `detail`. An
-- exception whose text was `stale_revision: answered 1 but the plan is at 2`
-- matched nothing, so the one refusal a client knows how to recover from — fetch
-- the plan and re-ask — arrived as a 500.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/private/move_membership.sql
-- ---------------------------------------------------------------------------
-- One membership, one circle, from one identity to another.
--
-- Both paths that move a membership use this: `reattach_member`, when a guest
-- comes back with no session (ADR 0006), and `claim_identity`, when somebody
-- saves their place and turns out to have had a permanent identity already.
-- One copy, because the cost of two is a table moved by one of them and left
-- behind by the other — and "left behind" means a guest who reattaches and
-- finds their answers gone.
--
-- It decides nothing. Who may move what is the caller's question: this assumes
-- it has already been answered and does the writing.
--
-- `member_dayparts` and any re-entry token for the membership are absent below
-- because they move themselves — both reference `circle_members` with
-- `on update cascade`, which 0006 and 0007 put there for this moment.
--
-- `analytics.events` is also deliberately absent, and it is the one table here
-- that *should* be: an event is a record of something that happened to an
-- identity at a time, and rewriting it would be rewriting history rather than
-- following a person. It has no foreign key to `auth.users`, so nothing
-- cascades it away either.
-- ---------------------------------------------------------------------------

create or replace function private.move_membership(
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
  -- The inputs are not changing, only whose they are — see `bump_input_version`.
  -- Local to the transaction, so it cannot leak into anything else.
  perform set_config('circles.moving_membership', 'on', true);

  -- Outstanding emailed links first, while `membership_user_id` still names the
  -- identity they were issued against: the write below cascades that column, and
  -- `enforce_reentry_for_guests` fires on it. `private.retire_reentry_links` says
  -- what happens and why, and `reconcile_contacts` calls it too — the
  -- duplicate-merge path reaches the same tokens by a different route.
  perform private.retire_reentry_links(p_circle_id, p_from, p_to);

  -- The membership itself, first: the cascading references follow this write.
  update public.circle_members m
  set user_id = p_to
  where m.circle_id = p_circle_id and m.user_id = p_from;

  -- Everything else the member owns. Each of these references `auth.users`
  -- with no action on update, so each is moved by name — and
  -- `090_identity_continuity.sql` checks the list against the catalogue rather
  -- than trusting that it is complete.
  update public.plan_responses r set user_id = p_to
  where r.user_id = p_from
    and r.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_participants pp set user_id = p_to
  where pp.user_id = p_from
    and pp.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_required_members rm set user_id = p_to
  where rm.user_id = p_from
    and rm.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.attendance a set user_id = p_to
  where a.user_id = p_from
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where p.circle_id = p_circle_id
    );

  update public.nudge_states n set user_id = p_to
  where n.user_id = p_from
    and n.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update private.plan_interest i set user_id = p_to
  where i.user_id = p_from
    and i.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The availability snapshots name who could come, and `transition_plan` reads
  -- the candidate's array at confirm time to decide who is `going`. A stale id
  -- there is this person marked `unknown` at the one moment the product is
  -- about.
  update public.candidates c
  set available_user_ids = array_replace(c.available_user_ids, p_from, p_to)
  where p_from = any (c.available_user_ids)
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  -- And the one id a near-miss carries. `{"kind":"required_missing","userId":…}`
  -- is the single rule the no-quorum screen shows — "the closest near-misses,
  -- the blocking rule, and three actions" (spec §5.6) — and it names somebody
  -- who is *not* available, so the array above never touches it. Left behind, it
  -- would name an identity that has just stopped being a member, and the screen
  -- would blame a person who is not there for a plan the person who *is* there
  -- is blocking.
  update public.candidates c
  set near_miss_reason = jsonb_set(c.near_miss_reason, '{userId}', to_jsonb(p_to::text))
  where c.near_miss_reason ->> 'kind' = 'required_missing'
    and c.near_miss_reason ->> 'userId' = p_from::text
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  update public.meetup_confirmations mc
  set available_user_ids = array_replace(mc.available_user_ids, p_from, p_to)
  where p_from = any (mc.available_user_ids)
    and mc.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The address this membership is reachable at, and everything hanging off it.
  -- In `private.reconcile_contacts`, shared with `adopt_membership_rows`, because
  -- the duplicate-merge path needs exactly the same work and having it here only
  -- left that path stranding a retired membership's consent and links.
  perform private.reconcile_contacts(p_circle_id, p_from, p_to);

  -- Queued mail for the person, not yet sent. A job left on the old identity is
  -- a message the dispatcher either sends to nobody or drops when retention
  -- takes the abandoned identity with it.
  update jobs.notification_jobs j set user_id = p_to
  where j.user_id = p_from
    and j.sent_at is null
    and j.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);
  perform set_config('circles.moving_membership', 'off', true);
end;
$$;

comment on function private.move_membership(uuid, uuid, uuid) is
  'Moves one circle membership and every row scoped to it from one identity to another. Shared by reattach_member and claim_identity; decides nothing.';

revoke all on function private.move_membership(uuid, uuid, uuid) from public;
revoke all on function private.move_membership(uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/public/candidate_summary.sql
-- ---------------------------------------------------------------------------
-- Where a plan stands, in the three words a screen has for it.
--
-- Spec §5.6 gives the candidates screen three states and only two of them are
-- plan states: `ready` has options, `no_quorum` has near-misses and the one
-- rule that blocked them, and `collecting` is the waiting state — "members see
-- nothing until options exist". The difference between the last two is whether
-- the engine has found anything to be close to, which is a fact about the set
-- rather than about the plan. `closed` is the fourth answer, for a plan that has
-- been confirmed, cancelled or expired: no screen shows candidates for one, and
-- a caller that asked about it should not be told "collecting".
--
-- Derived in one place because two callers need the same answer —
-- `store_candidate_set` returns it whether it stored anything or not — and a
-- summary that disagreed with itself depending on which branch produced it
-- would be worse than none.
-- ---------------------------------------------------------------------------

create or replace function public.candidate_summary(plan public.plans, p_stored boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select cs.id, cs.eligible_count,
      (select count(*) from public.candidates c
       where c.candidate_set_id = cs.id and c.is_near_miss) as near_misses
    from public.candidate_sets cs
    where cs.plan_id = plan.id
      and cs.revision = plan.revision
      and cs.input_version = plan.input_version
  )
  select jsonb_build_object(
    'stored', p_stored,
    'candidate_set_id', (select id from live),
    -- Which version of the plan this describes. The caller has just moved it —
    -- an answer bumps `input_version` — and reading it back out of the same
    -- answer saves a second round trip to ask what it became.
    'input_version', plan.input_version,
    'state', case
      when plan.state = 'ready' then 'ready'
      -- Anything that is not collecting availability is `closed` to this
      -- screen, and that includes a quiet ask still `seeking` and a plan still
      -- in `draft`: nothing is being collected for either, and answering
      -- "collecting" about one would be the screen waiting for replies nobody
      -- has been asked for.
      when plan.state <> 'collecting' then 'closed'
      when coalesce((select near_misses from live), 0) > 0 then 'no_quorum'
      else 'collecting'
    end,
    'eligible', coalesce((select eligible_count from live), 0),
    'near_misses', coalesce((select near_misses from live), 0)
  );
$$;

comment on function public.candidate_summary(public.plans, boolean) is
  'Where a plan stands for the candidates screen — ready, no_quorum, collecting or closed — with the set that is current for it. Service role only; clients read candidate_sets directly under RLS.';

revoke all on function public.candidate_summary(public.plans, boolean) from public;
revoke all on function public.candidate_summary(public.plans, boolean) from anon, authenticated;
grant execute on function public.candidate_summary(public.plans, boolean) to service_role;

-- supabase/sql/functions/public/engine_input.sql
-- ---------------------------------------------------------------------------
-- Everything the candidate engine needs about a plan, in one read.
--
-- Three tables and a join, and the reason it is a function rather than three
-- queries from the Edge Function is that the engine's answer is only as
-- trustworthy as the inputs agreeing with each other. Read separately, the
-- roster can change between the members query and the responses query, and the
-- set that comes out is one nobody ever had: a member who answered and is no
-- longer there, or one who joined between the two statements and appears as a
-- non-responder to a question they were never asked. One statement is one
-- snapshot.
--
-- It is `stable`, and deliberately takes no lock: the compare-and-set in
-- `store_candidate_set` is what makes a stale result harmless, so reading
-- without blocking answers is right. A recalculation that loses the race is
-- discarded and another follows.
--
-- In `public` because PostgREST exposes nothing else, and granted to
-- `service_role` alone: this returns every member's answer to a plan, which is
-- precisely what `plan_responses_select_own` exists to stop a client seeing
-- (spec §5.5 — "your friends will only see a combined result"). The combined
-- result is what `candidates` holds, and that is the table clients read.
-- ---------------------------------------------------------------------------

create or replace function public.engine_input(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan', jsonb_build_object(
      'id', p.id,
      'circle_id', p.circle_id,
      'state', p.state,
      'revision', p.revision,
      'input_version', p.input_version,
      'scoring_version', p.scoring_version,
      'time_zone', p.time_zone,
      'window_start', p.window_start,
      'window_end', p.window_end,
      'daily_start_local', p.daily_start_local,
      'daily_end_local', p.daily_end_local,
      'duration_minutes', p.duration_minutes,
      'quorum', p.quorum,
      'response_deadline', p.response_deadline,
      'required_member_ids', (
        select coalesce(jsonb_agg(rm.user_id order by rm.user_id), '[]'::jsonb)
        from public.plan_required_members rm
        where rm.plan_id = p.id and rm.revision = p.revision
      )
    ),
    -- **Who the plan was asked of**, not who is in the circle. The two are
    -- different lists and the database already says which one means what:
    -- `plan_participants` is the audience of a revision, `replace_response`
    -- refuses anybody else with `not_a_participant`, and `transition_plan`
    -- carries the audience across an edit rather than recomputing it, because
    -- spec §9 makes joining an active plan an opt-in — "new members may opt into
    -- the active plan", not "new members are added to it".
    --
    -- Reading `circle_members` here would have been a second definition of the
    -- same thing, and the two disagree the moment somebody joins mid-plan: the
    -- engine would count them in `active_member_count`, the screens would show
    -- "4 of 7" and a dashed mark against a person who was never asked and whom
    -- `replace_response` will not let answer.
    --
    -- Still filtered on active membership, because a participant who has left is
    -- not being asked either. Order is part of the input rather than a detail of
    -- the read — every available list the engine returns is sorted into it, and
    -- `inputHash` includes it unsorted for that reason.
    'active_member_ids', (
      select coalesce(jsonb_agg(pp.user_id order by pp.joined_at, pp.user_id), '[]'::jsonb)
      from public.plan_participants pp
      join public.circle_members m
        on m.circle_id = p.circle_id and m.user_id = pp.user_id and m.status = 'active'
      where pp.plan_id = p.id and pp.revision = p.revision
    ),
    -- Answers to the revision being asked, from people who are still being
    -- asked. The engine filters by the roster too — it walks `active_member_ids`
    -- — and this filter is what keeps `responded_count` honest as well: a plan
    -- whose one reply came from somebody who has left is still waiting for its
    -- first.
    'responses', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'user_id', r.user_id,
            'status', r.status,
            'windows', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object('start', w.starts_at, 'end', w.ends_at)
                  order by w.starts_at
                ),
                '[]'::jsonb
              )
              from public.willing_windows w
              where w.response_id = r.id
            )
          )
          order by r.user_id
        ),
        '[]'::jsonb
      )
      from public.plan_responses r
      join public.plan_participants pp
        on pp.plan_id = r.plan_id and pp.revision = r.revision and pp.user_id = r.user_id
      join public.circle_members m
        on m.circle_id = p.circle_id and m.user_id = r.user_id and m.status = 'active'
      where r.plan_id = p.id and r.revision = p.revision
    )
  )
  from public.plans p
  where p.id = p_plan_id;
$$;

comment on function public.engine_input(uuid) is
  'One consistent snapshot of a plan, its active roster and the answers to its current revision, shaped for generateCandidates. Service role only: it carries every member''s answer.';

revoke all on function public.engine_input(uuid) from public;
revoke all on function public.engine_input(uuid) from anon, authenticated;
grant execute on function public.engine_input(uuid) to service_role;

-- supabase/sql/functions/public/plan_candidate_summary.sql
-- ---------------------------------------------------------------------------
-- Where a plan stands, asked about the plan rather than handed one.
--
-- `candidate_summary` takes a `public.plans` row because its callers already
-- hold one under a lock. This is for the caller that does not: the Edge
-- Function's path where the recalculation itself failed, and the answer that
-- prompted it has nonetheless been stored (ADR 0018). Reporting an error for a
-- request that worked would be false, so the endpoint says where the plan is —
-- and it needs a way to ask that does not involve running the engine again.
-- ---------------------------------------------------------------------------

create or replace function public.plan_candidate_summary(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.candidate_summary(p, false) from public.plans p where p.id = p_plan_id;
$$;

comment on function public.plan_candidate_summary(uuid) is
  'Where a plan stands for the candidates screen, by plan id. Service role only; the summary reports nothing a member could not read from candidate_sets.';

revoke all on function public.plan_candidate_summary(uuid) from public;
revoke all on function public.plan_candidate_summary(uuid) from anon, authenticated;
grant execute on function public.plan_candidate_summary(uuid) to service_role;

-- supabase/sql/functions/public/replace_response.sql
-- Parameters carry a `p_` prefix, as `transition_plan`'s do: a parameter named
-- `plan_id` is ambiguous against the column of the same name inside
-- `on conflict (plan_id, …)`, and plpgsql refuses to guess.

create or replace function public.replace_response(
  p_plan_id uuid,
  -- The revision the client is answering. Required, because an answer is an
  -- answer to a *question*, and the question can change while a draft sits on
  -- a phone with no signal (spec §5.5). Storing revision 1's windows under
  -- revision 2 would be silently answering dates the person never saw.
  p_revision integer,
  p_status text,
  p_windows jsonb default '[]'::jsonb,
  p_used_calendar_overlay boolean default false
)
returns public.plan_responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  response public.plan_responses;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- The lock: two submissions from one person's two devices would otherwise
  -- interleave their window deletes and inserts.
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not public.auth_is_member(plan.circle_id) then
    -- The same answer for "no such plan" and "not your circle": telling them
    -- apart would confirm a plan id exists.
    raise exception 'plan_not_found' using errcode = 'insufficient_privilege';
  end if;

  -- The question moved on. Refused with its own code so the client can fetch
  -- the plan again and re-ask, rather than being told its window was malformed.
  --
  -- The two revisions go in `detail`, not in the message: `_shared/problem.ts`
  -- turns an exception's text into a `ProblemReason` by exact match, so a
  -- message with numbers in it is a refusal no endpoint can translate — the
  -- client got 500 for the one refusal it knows how to recover from. The
  -- numbers are still in the database log, where whoever is debugging is.
  if p_revision <> plan.revision then
    raise exception 'stale_revision'
      using errcode = 'serialization_failure',
            detail = format('answered %s but the plan is at %s', p_revision, plan.revision);
  end if;

  -- Addressed to this person: spec §9 makes joining an active plan an opt-in,
  -- and answering a question you were not asked is how a newcomer becomes a
  -- non-responder to it.
  if not exists (
    select 1 from public.plan_participants pp
    where pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = caller
  ) then
    raise exception 'not_a_participant' using errcode = 'insufficient_privilege';
  end if;

  -- "Editing is allowed until confirmation or the deadline" (spec §5.5). One
  -- name for both, because they are one answer to the person: replies are
  -- closed. Which of the two it was goes in `detail`.
  if plan.state not in ('collecting', 'ready') then
    raise exception 'replies_closed' using errcode = 'check_violation',
      detail = format('the plan is %s', plan.state);
  end if;
  if now() >= plan.response_deadline then
    raise exception 'replies_closed' using errcode = 'check_violation',
      detail = format('the deadline passed at %s', plan.response_deadline);
  end if;

  -- A SQL null is not an empty list: `jsonb_array_length(null)` is null, and
  -- `null = 0` is not true, so a null slipped past this check and produced a
  -- `windows` answer with no windows. Coalesce first, and insist on an array.
  p_windows := coalesce(p_windows, '[]'::jsonb);
  if jsonb_typeof(p_windows) <> 'array' then
    raise exception 'windows_do_not_match_status' using errcode = 'check_violation',
      detail = 'windows must be a list';
  end if;

  -- The domain's union, enforced: only a `windows` answer carries windows, and
  -- a `windows` answer carries at least one. One name, because it is one
  -- mistake from either side — and a name rather than a sentence, so that a
  -- caller who reaches this function directly gets the same 400 the request
  -- schema would have given.
  if (p_status = 'windows') <> (jsonb_array_length(p_windows) > 0) then
    raise exception 'windows_do_not_match_status' using errcode = 'check_violation',
      detail = format('a %s answer carries %s windows', p_status, jsonb_array_length(p_windows));
  end if;

  -- One bump for the whole answer, at the end; the row triggers stand down
  -- for the length of this function.
  perform set_config('circles.in_replace_response', 'on', true);

  -- Replace, not merge. The person's answer is the whole list they sent.
  delete from public.willing_windows ww
  using public.plan_responses r
  where ww.response_id = r.id
    and r.plan_id = plan.id and r.revision = plan.revision and r.user_id = caller;

  insert into public.plan_responses (plan_id, revision, user_id, status, used_calendar_overlay, submitted_at)
  values (plan.id, plan.revision, caller, p_status, p_used_calendar_overlay, now())
  on conflict (plan_id, revision, user_id) do update
    set status = excluded.status,
        used_calendar_overlay = excluded.used_calendar_overlay,
        submitted_at = excluded.submitted_at
  returning * into response;

  insert into public.willing_windows (response_id, starts_at, ends_at)
  select response.id, (w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz
  from jsonb_array_elements(p_windows) as w;

  perform set_config('circles.in_replace_response', 'off', true);
  update public.plans p set input_version = p.input_version + 1 where p.id = plan.id;

  -- Architecture §8.3: `ready ─(response change)─▶ collecting`. A ready plan
  -- whose answers just moved has no current candidate set — `confirm` would
  -- refuse the old one as stale while every state-driven screen and job still
  -- saw "ready". `candidates_gone` is the engine's verdict and carries no
  -- actor guard, so the person who answered can be the one to fire it; the
  -- recalculation brings it back to ready.
  if plan.state = 'ready' then
    perform planning.transition_plan(plan.id, 'candidates_gone', caller);
  end if;

  -- `availability.response_submitted` is written to `jobs.outbox` by the row
  -- trigger on `plan_responses` (0006), in this transaction: one event per
  -- answer, because the upsert above touches the row exactly once.

  return response;
end;
$$;

comment on function public.replace_response(uuid, integer, text, jsonb, boolean) is
  'Replaces the caller''s answer to the given plan revision atomically; refuses a revision the plan has moved past. The only write path for responses and windows (ADR 0013).';

revoke all on function public.replace_response(uuid, integer, text, jsonb, boolean) from public;
revoke all on function public.replace_response(uuid, integer, text, jsonb, boolean) from anon, authenticated;
grant execute on function public.replace_response(uuid, integer, text, jsonb, boolean) to authenticated;

-- supabase/sql/functions/public/store_candidate_set.sql
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
  -- Each id against the list it came from, which is not the same list twice.
  --
  -- An **available** id is somebody the plan asked, so it has to be a
  -- participant. A **`required_missing`** id is the opposite kind of fact: the
  -- blocking rule names a required member who is *not* available, and spec §9's
  -- "a required person leaves: the plan becomes ineligible until the organiser
  -- changes required members or cancels" is precisely a required member who is
  -- no longer a participant. Checking that one against `plan_participants` —
  -- which an earlier draft of this guard did — refused the only result that can
  -- ever describe the state §9 asks for, leaving the plan showing the set from
  -- before they left.
  --
  -- Both lists move together when a membership does: `move_membership` rewrites
  -- `plan_participants` and `plan_required_members` alike, so a result computed
  -- before a move is still discarded either way.
  if exists (
    with named as (
      select item.value as entry
      from jsonb_array_elements(
        coalesce(p_set -> 'eligible', '[]'::jsonb) || coalesce(p_set -> 'nearMisses', '[]'::jsonb)
      ) as item
    )
    select 1
    from named, lateral jsonb_array_elements_text(entry -> 'availableUserIds') as available(user_id)
    where not exists (
      select 1 from public.plan_participants pp
      where pp.plan_id = plan.id
        and pp.revision = plan.revision
        and pp.user_id = available.user_id::uuid
    )
    union all
    select 1
    from named
    where entry -> 'reason' ->> 'kind' = 'required_missing'
      and not exists (
        select 1 from public.plan_required_members rm
        where rm.plan_id = plan.id
          and rm.revision = plan.revision
          and rm.user_id = (entry -> 'reason' ->> 'userId')::uuid
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

-- END GENERATED: function definitions
