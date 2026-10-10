-- 0049_chased_answer_optional
--
-- "Lock it in" is no longer gated on the chasing question (SUS-194). An
-- organiser who locks a time in without answering "Did you have to chase anyone
-- outside the app?" leaves `meetup_confirmations.chased_answer` null. The
-- column was always nullable; what changes is that both confirm functions now
-- accept it (their definitions are regenerated below), and the "answered without
-- being chased" gate (spec §11.4) counts the confirmations that left it blank
-- separately, instead of dropping them without a trace or reading them as "no".
--
-- An unanswered confirmation is in neither the numerator nor the denominator of
-- the share: nobody said how many were chased, so there is nothing to count. It
-- is reported as `unanswered`, a count of confirmations, beside the share.

create or replace view analytics.gate_unchased as
select
  mc.confirmed_at::date as day,
  coalesce(sum(r.members) filter (where mc.chased_answer is not null), 0)::bigint as members,
  coalesce(sum(
    case mc.chased_answer
      when 'none' then r.responders
      when 'one' then greatest(r.responders - 1, 0)
      else 0
    end
  ) filter (where mc.chased_answer is not null), 0)::bigint as unchased,
  cc.cohort,
  count(*) filter (where mc.chased_answer is null)::bigint as unanswered
from (
  select distinct on (c.plan_id, c.revision) c.*
  from public.meetup_confirmations c
  order by c.plan_id, c.revision, c.confirmed_at desc
) mc
join public.plans pl on pl.id = mc.plan_id
join analytics.circle_cohort cc on cc.circle_id = pl.circle_id
cross join lateral (
  select
    (select count(*) from public.plan_participants pp
      where pp.plan_id = mc.plan_id and pp.revision = mc.revision) as members,
    (select count(*) from public.plan_responses pr
      where pr.plan_id = mc.plan_id and pr.revision = mc.revision) as responders
) r
group by 1, cc.cohort;

comment on view analytics.gate_unchased is
  'Per day and cohort: of the members of meetups whose organiser answered the chasing question, how many answered without being chased; and, separately, how many confirmations left the question unanswered (those are in neither count).';

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
  -- "Did you have to chase anyone outside the app?" (spec §5.10). Optional for
  -- the organiser: the review screen never holds "Lock it in" for it (SUS-194),
  -- and null is stored as "not answered". It stays a parameter with no default,
  -- ahead of the optional details (a parameter with no default cannot follow one
  -- that has it), so a caller passes null rather than leaving it out. Anything
  -- else than `none | one | more` is refused, whichever door it came through.
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

  if p_chased_answer is not null and p_chased_answer not in ('none', 'one', 'more') then
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

-- supabase/sql/functions/public/confirm_own_time.sql
-- ---------------------------------------------------------------------------
-- Locking in a time the organiser chose themselves (ADR 0051).
--
-- A wrapper over `planning.transition_plan(plan, 'confirm_own', …)`, as
-- `confirm_meetup` is for an option, and for the same reasons: `planning` is not
-- reachable by a client, and the actor must be `auth.uid()` rather than an
-- argument. The machine does the rest under the plan's lock: the organiser
-- guard, the stretch being a valid one (`private.own_time_problem`), the frozen
-- confirmation, who is going, and `confirmation.meetup_confirmed`.
--
-- **Freezing only what the organiser saw.** A candidate lock-in names the set it
-- was looking at (`expected_set_id`, ADR 0018). An own time has no set, so it
-- names the plan's `input_version`, which every answer moves. If somebody
-- answered while the organiser was looking, the names on the screen are not the
-- names that would be frozen, and the request is refused as `stale_availability`
-- so the screen can update and ask again. Null first and on its own, for the
-- reason `confirm_meetup` has: a caller who names no version was not looking at
-- one.
--
-- The plan's own state is checked ahead of the version, so a cancelled plan says
-- so rather than saying its names are out of date.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_own_time(
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  -- The plan's input version as `stretch_availability` returned it with the
  -- names the organiser was shown.
  p_expected_input_version integer,
  -- "Did you have to chase anyone outside the app?" (spec §5.10), optional as in
  -- `confirm_meetup`: null is stored as "not answered" (SUS-194).
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
    raise exception 'confirm_own_time requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  -- Membership before anything that can be observed, and a non-member gets the
  -- answer a plan that is not there would get (see `confirm_meetup`).
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if p_chased_answer is not null and p_chased_answer not in ('none', 'one', 'more') then
    raise exception 'chased_answer_required' using errcode = 'P0001';
  end if;

  if plan.state not in ('collecting', 'ready') then
    raise exception '%', case
      when plan.state in ('completed', 'expired', 'cancelled') then 'plan_is_finished'
      else 'wrong_state'
    end using errcode = 'P0001';
  end if;

  if p_expected_input_version is distinct from plan.input_version then
    raise exception 'stale_availability' using errcode = 'P0001';
  end if;

  perform planning.transition_plan(
    p_plan_id,
    'confirm_own',
    caller,
    jsonb_strip_nulls(jsonb_build_object(
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
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

comment on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) is
  'Locks in a time the calling organiser chose, through planning.transition_plan, and refuses it as stale_availability when an answer arrived since the names they were shown (ADR 0051).';

revoke all on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) from public;
revoke all on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) from anon, authenticated;
grant execute on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) to authenticated;

-- supabase/sql/functions/public/founder_analytics.sql
-- ---------------------------------------------------------------------------
-- The founder's analytics screen, to one pair of eyes (SUS-166).
--
-- The north star, the decision gates' two numbers each (counted once for the
-- founder cohort's circles and once for the external cohort's, spec §11.4,
-- ADR 0058, and never pooled), the funnel's row
-- counts and every event's weekly count with its boolean and enum splits, from
-- the Monday of the week `p_since` falls in, as one object.
--
-- **The allowlist is the same one as `founder_summary`'s and is checked the
-- same way: against `auth.uid()`, never a parameter.** A function that takes
-- the user it should authorise authorises whoever calls it. Everybody else,
-- `anon` included, is refused with `insufficient_privilege` before the period
-- is even looked at.
--
-- **What comes back names nobody and nothing.** Every number is a count, a
-- ratio's two halves, or one median. No view it reads has a user, anonymous,
-- circle or plan id as a column that is returned: `event_breakdown` drops
-- identifiers and anything that is not a boolean or an enum word in SQL, and
-- the unattributed events are totals. The client is handed what it may show
-- and is not trusted to leave the rest out.
--
-- A gate this does not return is a gate nothing computes, and the screen says
-- so ("Not measured"); a gate returned with a zero denominator is one with no
-- data yet, which is a different sentence.
--
-- The period is clamped to 400 days: it is a cost bound, not a rule, and the
-- answer says from when it is.
-- ---------------------------------------------------------------------------
create or replace function public.founder_analytics(p_since date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  v_from date;
begin
  if caller is null or not exists (
    select 1 from private.allowlist a where a.user_id = caller
  ) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;

  if p_since is null then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_from := date_trunc('week', greatest(p_since, current_date - 400))::date;

  return jsonb_build_object(
    'since', v_from,
    'north_star', (
      select coalesce(jsonb_agg(to_jsonb(v) order by v.month), '[]'::jsonb)
      from analytics.north_star_monthly v
      where v.month >= date_trunc('month', v_from)
    ),
    -- Every gate is counted once per cohort (spec §11.4); the screen reads the
    -- founder cohort's gates from `founder` and the external cohort's from
    -- `external`. Nothing is pooled.
    'gates', (
      select jsonb_object_agg(k.cohort, jsonb_build_object(
          'confirmed_meetup', (
            select jsonb_build_object(
              'numerator', coalesce(sum(confirmed), 0)::int, 'denominator', coalesce(sum(circles), 0)::int)
            from analytics.gate_circles_confirm where day >= v_from and cohort = k.cohort),
          'unchased', (
            select jsonb_build_object(
              'numerator', coalesce(sum(unchased), 0)::int, 'denominator', coalesce(sum(members), 0)::int,
              'unanswered', coalesce(sum(unanswered), 0)::int)
            from analytics.gate_unchased where day >= v_from and cohort = k.cohort),
          'response_time', (
            select jsonb_build_object(
              'median_seconds', percentile_cont(0.5) within group (order by seconds), 'n', count(*)::int)
            from analytics.open_to_response where day >= v_from and cohort = k.cohort),
          'happened', (
            select jsonb_build_object(
              'numerator', coalesce(sum(happened), 0)::int, 'denominator', coalesce(sum(meetups), 0)::int)
            from analytics.gate_happened where day >= v_from and cohort = k.cohort),
          'reattach', (
            select jsonb_build_object(
              'numerator', coalesce(sum(reattached), 0)::int, 'denominator', coalesce(sum(missing), 0)::int)
            from analytics.gate_reattach where day >= v_from and cohort = k.cohort),
          'second_meetup', (
            select jsonb_build_object('count', coalesce(sum(circles), 0)::int)
            from analytics.gate_second_meetup where day >= v_from and cohort = k.cohort),
          'other_organiser', (
            select jsonb_build_object('count', coalesce(sum(plans), 0)::int)
            from analytics.gate_other_organiser where day >= v_from and cohort = k.cohort),
          'email_verified', (
            select jsonb_build_object(
              'numerator', coalesce(sum(verified), 0)::int, 'denominator', coalesce(sum(submitted), 0)::int)
            from analytics.gate_email_verified where day >= v_from and cohort = k.cohort),
          'confirm_in_week', (
            select jsonb_build_object(
              'numerator', coalesce(sum(confirmed_in_week), 0)::int, 'denominator', coalesce(sum(circles), 0)::int)
            from analytics.gate_confirm_in_week where day >= v_from and cohort = k.cohort),
          'another_in_cadence', (
            select jsonb_build_object(
              'numerator', coalesce(sum(another), 0)::int, 'denominator', coalesce(sum(successful), 0)::int)
            from analytics.gate_another_in_cadence where day >= v_from and cohort = k.cohort),
          'claim_moments', (
            select jsonb_build_object(
              'numerator', coalesce(sum(elsewhere), 0)::int, 'denominator', coalesce(sum(claims), 0)::int)
            from analytics.gate_claim_moments where day >= v_from and cohort = k.cohort)
      ))
      from (values ('founder'), ('external')) as k(cohort)
    ),
    'cohort_circles', (
      select coalesce(jsonb_object_agg(k.cohort, (
        select count(*)::int from analytics.circle_cohort cc where cc.cohort = k.cohort
      )), '{}'::jsonb)
      from (values ('founder'), ('external')) as k(cohort)
    ),
    'counters', (
      select coalesce(jsonb_object_agg(c.counter, c.n), '{}'::jsonb)
      from (
        select f.counter, sum(f.n)::int as n
        from analytics.funnel_counts f
        where f.day >= v_from
        group by f.counter
        union all
        select 'second_meetup_circles', coalesce(sum(s.circles), 0)::int
        from analytics.gate_second_meetup s
        where s.day >= v_from
      ) c
    ),
    'events', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'event_name', b.event_name,
          'schema_version', b.schema_version,
          'week', b.week,
          'field', b.field,
          'value', b.value,
          'events', b.events
        ) order by b.event_name, b.week, b.field nulls first, b.value
      ), '[]'::jsonb)
      from analytics.event_breakdown b
      where b.week >= v_from
    )
  );
end;
$$;

comment on function public.founder_analytics(date) is
  'The founder analytics screen''s numbers, from the Monday of p_since''s week, for a user in private.allowlist and nobody else. The allowlist is checked against auth.uid(). Counts and ratios only: no user, anonymous, circle or plan id and no free text.';

revoke all on function public.founder_analytics(date) from public;
revoke all on function public.founder_analytics(date) from anon;
grant execute on function public.founder_analytics(date) to authenticated;

-- END GENERATED: function definitions
