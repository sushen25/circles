-- ---------------------------------------------------------------------------
-- The work a clock creates, discovered from data rather than from a timer
-- (architecture §9.3).
--
-- Five things, every run, all of them queries:
--
-- 1. **A deadline that has passed.** Nothing emits `planning.deadline_passed`
--    — it is not a transition, and S1-11 left it for the sweep to raise. It is
--    emitted into the outbox rather than turned into a job here, so that the
--    one place events become notifications stays the drain. Once per
--    **deadline**, not once per plan: "give it one more day" (spec §5.7) moves
--    the deadline out and it passes again, and a marker keyed on the plan
--    would announce the second one to nobody. The outbox is still the marker,
--    which holds because a plan cannot outlive its own window by the thirty
--    days retention keeps events for (rule 2 below closes it long before).
--
-- 2. **A plan whose last possible start has gone.** Spec §9: "the plan stays
--    decidable until the last candidate start, then expires." The last start
--    is `public.plan_last_possible_start` — the same function the deadline
--    constraint uses, so the moment a plan stops being decidable and the
--    moment it may no longer be answered are one definition rather than two.
--    `expire` has no guards, so the actor is null: nobody did this, the window
--    closed.
--
-- 3. **A plan whose candidate set is stale.** After ADR 0018 every answer
--    recalculates in the request that caused it, and the cases with no request
--    to attach to are this function's: a member removed by a trigger, a
--    recalculation that lost its compare-and-set. Found by asking which plans
--    have no `candidate_sets` row at the version they are on (S1-16).
--
-- 4. **A deadline 24 hours out.** The plans, not the people: who is owed a
--    reminder is `recipientsFor('deadline_approaching')`'s answer and belongs
--    in the domain.
--
-- 5. **A circle that may be due a nudge** (S2-04). The circles, not the
--    decision: whether one is owed, for which due date and to whom is
--    `nudgeDueDate` and `nudgeChoice`'s, in the domain. This is a coarse
--    superset of the circles that could be owed one, so the domain is asked
--    about few circles rather than all of them: active, with a goal and a
--    history, nothing open, not snoozed, not already decided for this cycle
--    (the prompt counted from its current `last_met_at`) — and met long
--    enough ago that the lead window can have opened. That last bound is the
--    domain's own arithmetic: the cadence added forward from the meetup on the
--    circle's wall clock, where a month is a calendar month clamped at its
--    end, less the lead days, less one more day for a DST hour. So no circle
--    the domain would call due is ever left out or named late; one it would
--    not is merely asked about and told no. Subtracting a month back from
--    now instead named a circle that met at the start of February two days
--    after its card appeared (review round 2). Oldest first, so a circle that
--    has waited longest is asked first.
-- 6. **A quiet ask at its stop time** (SUS-50). Plans
--    `seeking` whose `quiet_expires_at` has passed expire, privately — the
--    one message is the initiator's, and it comes from the drain reading the
--    `planning.plan_expired` this writes. And the asks **held** at their
--    threshold beside an open plan (ADR 0035) whose circle is free again are
--    named, with what the domain needs to give each its deadline; the
--    dispatcher opens them through `dispatch_open_quiet_ask`.
--
-- Each transition is attempted on its own and a refusal is counted rather than
-- thrown: a plan that was confirmed between the select and the update is a
-- race with a correct outcome, and losing it must not abandon the rest of the
-- batch.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_timed_work(p_limit integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  batch integer := greatest(1, least(coalesce(p_limit, 50), 200));
  target record;
  closed integer := 0;
  expired integer := 0;
  refused integer := 0;
  quiet_expired integer := 0;
begin
  for target in
    select p.id, p.circle_id, p.revision, p.response_deadline
    from public.plans p
    where p.state in ('collecting', 'ready')
      and p.response_deadline <= now()
      and not exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed'
          and o.aggregate_id = p.id
          and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
      )
    order by p.response_deadline
    limit batch
  loop
    perform jobs.emit('planning.deadline_passed', 'plan', target.id, jsonb_build_object(
      'plan_id', target.id, 'circle_id', target.circle_id, 'revision', target.revision,
      -- The marker, and the reason it is in the payload rather than implied by
      -- the row: spec §5.7's replies-closed screen offers "give it one more
      -- day", and an extended deadline passes a second time. Keyed on the plan
      -- alone, the second one is announced to nobody — and the organiser's only
      -- channel in Slice 1 is this letter. An instant is an allowed payload
      -- value: `jobs.carries_content` takes `[A-Za-z0-9_./:+-]` up to 40, and
      -- this is 32.
      --
      -- **To the microsecond, and rendered rather than cast.** The first
      -- version of this used `OF:00` and lost the fraction, so the comparison
      -- below — which is at full precision — never matched a marker it had
      -- written itself, and every plan with a fractional deadline was
      -- announced again every minute for as long as it stayed open. Almost
      -- every deadline is fractional: `defaultDeadline` is `now + 1h`. Found
      -- in review round 2, and it is why the round-2 test runs the sweep twice
      -- against one deadline rather than once against two.
      --
      -- Rendered in UTC with an explicit offset rather than left to jsonb's
      -- own cast, which would use the session's `TimeZone` and make the stored
      -- string depend on who called.
      'deadline', to_char(target.response_deadline at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')));
    closed := closed + 1;
  end loop;

  for target in
    select p.id
    from public.plans p
    where p.state in ('collecting', 'ready')
      and public.plan_last_possible_start(
            p.window_end, p.daily_end_local, p.duration_minutes, p.time_zone) <= now()
    order by p.window_end
    limit batch
  loop
    begin
      perform planning.transition_plan(target.id, 'expire', null);
      expired := expired + 1;
    exception when others then
      refused := refused + 1;
    end;
  end loop;

  -- Quiet asks (SUS-50) ------------------------------------------------------
  -- From its stop time an ask only expires (`nextQuietStep`), held or not.
  -- `('seeking', 'expire')` has no guards, so the actor is null; `event_for`
  -- names it `planning.plan_expired`, whose `from_state` tells the drain it
  -- never opened.
  for target in
    select p.id
    from public.plans p
    where p.mode = 'quiet' and p.state = 'seeking' and p.quiet_expires_at <= now()
    order by p.quiet_expires_at
    limit batch
  loop
    begin
      perform planning.transition_plan(target.id, 'expire', null);
      quiet_expired := quiet_expired + 1;
    exception when others then
      refused := refused + 1;
    end;
  end loop;
  -- End quiet asks (SUS-50) --------------------------------------------------

  return jsonb_build_object(
    'quiet_expired', quiet_expired,
    -- Held asks whose circle has no plan `collecting` or `ready` now: at their
    -- threshold, before their stop time. The timing is what `defaultDeadline`
    -- needs; the count and the answers stay here (SUS-50).
    'held', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'preset', x.quiet_preset, 'window_start', x.window_start,
        'window_end', x.window_end, 'daily_start_local', x.daily_start_local,
        'daily_end_local', x.daily_end_local, 'duration_minutes', x.duration_minutes,
        'time_zone', x.time_zone
      )) from (
        select p.*
        from public.plans p
        where p.mode = 'quiet' and p.state = 'seeking' and p.quiet_expires_at > now()
          and (
            select count(*) from private.plan_interest i
            where i.plan_id = p.id and i.response = 'keen'
          ) >= p.quiet_threshold
          and not exists (
            select 1 from public.plans o
            where o.circle_id = p.circle_id and o.id <> p.id and o.state in ('collecting', 'ready')
          )
        order by p.quiet_expires_at
        limit batch
      ) x
    ), '[]'::jsonb),
    'deadline_passed', closed,
    'expired', expired,
    'expire_refused', refused,
    'stale', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and not exists (
            select 1 from public.candidate_sets cs
            where cs.plan_id = p.id
              and cs.revision = p.revision
              and cs.input_version = p.input_version
          )
        order by p.updated_at
        limit least(batch, 20)
      ) x
    ), '[]'::jsonb),
    'approaching', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and p.response_deadline > now()
          and p.response_deadline <= now() + interval '24 hours'
        order by p.response_deadline
        limit batch
      ) x
    ), '[]'::jsonb),
    'cadence', coalesce((
      select jsonb_agg(x.id) from (
        select c.id
        from public.circles c
        where c.status = 'active'
          and c.cadence <> 'none'
          and c.last_met_at is not null
          and ((c.last_met_at at time zone c.time_zone) + case c.cadence
            when 'weekly' then interval '7 days'
            when 'fortnightly' then interval '14 days'
            when 'monthly' then interval '1 month'
            else interval '2 months'
          end - case c.cadence
            when 'weekly' then interval '3 days'
            when 'fortnightly' then interval '3 days'
            else interval '8 days'
          end) at time zone c.time_zone <= now()
          and (c.cadence_snoozed_until is null or c.cadence_snoozed_until <= now())
          and not exists (
            select 1 from public.plans p
            where p.circle_id = c.id
              and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
          )
          and not exists (
            select 1 from private.cadence_prompts cp
            where cp.circle_id = c.id and cp.last_met_at = c.last_met_at
          )
        order by c.last_met_at
        limit batch
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.dispatch_timed_work(integer) is
  'One pass of the time-based work: emits planning.deadline_passed once per plan, expires plans whose last possible start has gone and quiet asks whose stop time has, and names the plans with a stale candidate set or a deadline within 24 hours, the circles that may be due a cadence nudge, and the held quiet asks whose circle is free. Service role only (S1-20, S2-02, S2-04).';

revoke all on function public.dispatch_timed_work(integer) from public;
revoke all on function public.dispatch_timed_work(integer) from anon, authenticated;
grant execute on function public.dispatch_timed_work(integer) to service_role;
