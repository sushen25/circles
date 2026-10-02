-- ---------------------------------------------------------------------------
-- What the others have said about a plan, for the person answering it
-- (SUS-129, ADR 0045).
--
-- The availability editor shows, as counts, what the people who have already
-- answered said: a figure on each day, on each block of hours, on each line of
-- the reader's answer and over each half hour. `plan_responses` and
-- `willing_windows` stay readable by their owner and nobody else; this is the
-- one way past that, and it hands back only what those counts need.
--
-- The counts are of **distinct people with any half hour in common** (the
-- founder's decision of 1 October 2026), which a count per half hour cannot
-- give: somebody free 6–7 and somebody free 8–9 are two people over 6–9, and
-- no half hour has more than one of them. So for each other person who gave
-- times, the result holds one entry per day they gave times on — their windows
-- that day — and nothing else about them:
--
--   * no user id, no name, no response id;
--   * nothing that links one day's entry to the same person's on another day:
--     the entries are ordered by the times in them, which say nothing a reader
--     cannot already see, and never by who gave them;
--   * never the caller's own answer;
--   * only answers to the plan's **current revision**, from people it is still
--     asking (`plan_participants`, active members — the engine's roster, so
--     "5 of 6" here is the "5 of 6" everywhere else).
--
-- Beyond what per-half-hour counts show, an entry says which start goes with
-- which end on a day. With exactly one other answer in, the entries are that
-- person's answer, day by day: the founder accepted both (ADR 0045).
--
-- **The threshold is enforced here**, not on the client: below one other
-- answer with times, `days` is empty. "I'm easy" answers do not meet it alone.
--
-- The caller must be an active member of the plan's circle; guests are
-- anonymous sessions, and members too. For anybody else, and for a plan that
-- does not exist, the answer is null: the question has none for them, and
-- null does not say which it was.
-- ---------------------------------------------------------------------------

create or replace function public.others_availability(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select p.id, p.circle_id, p.revision, p.time_zone
    from public.plans p
    join public.circle_members me
      on me.circle_id = p.circle_id and me.user_id = (select auth.uid()) and me.status = 'active'
    where p.id = p_plan_id
  ),
  asked as (
    select pp.user_id
    from plan
    join public.plan_participants pp
      on pp.plan_id = plan.id and pp.revision = plan.revision
    join public.circle_members m
      on m.circle_id = plan.circle_id and m.user_id = pp.user_id and m.status = 'active'
  ),
  answers as (
    select r.id, r.user_id, r.status
    from plan
    join public.plan_responses r
      on r.plan_id = plan.id and r.revision = plan.revision
    where r.user_id in (select user_id from asked)
  ),
  others as (
    select a.id, a.status from answers a where a.user_id <> (select auth.uid())
  ),
  counts as (
    select
      (select count(*) from asked)::integer as asked,
      (select count(*) from others)::integer as answered,
      (select count(*) from others where status = 'windows')::integer as with_times,
      (select count(*) from others where status = 'flexible')::integer as flexible,
      exists (select 1 from answers where user_id = (select auth.uid())) as reader_answered
  ),
  -- One person's windows on one local day of the plan.
  entries as (
    select
      jsonb_agg(
        jsonb_build_object('start', w.starts_at, 'end', w.ends_at)
        order by w.starts_at
      ) as windows,
      min(w.starts_at) as first_start,
      max(w.ends_at) as last_end
    from others o
    join public.willing_windows w on w.response_id = o.id
    cross join plan
    where o.status = 'windows'
    group by o.id, (w.starts_at at time zone plan.time_zone)::date
  )
  select jsonb_build_object(
    'asked', c.asked,
    'answered', c.answered,
    'with_times', c.with_times,
    'flexible', c.flexible,
    'reader_answered', c.reader_answered,
    'days', case
      when c.with_times < 1 then '[]'::jsonb
      else (
        select coalesce(
          jsonb_agg(e.windows order by e.first_start, e.last_end, e.windows::text),
          '[]'::jsonb
        )
        from entries e
      )
    end
  )
  from counts c
  where exists (select 1 from plan);
$$;

comment on function public.others_availability(uuid) is
  'For an active member answering a plan: how many it asks, how many others have answered (with times, "I''m easy"), whether the caller has, and each other person''s windows per day with nothing to say whose or to link days. Current revision only, never the caller''s own, empty below one other answer with times. Null for anybody else (SUS-129).';

revoke all on function public.others_availability(uuid) from public;
revoke all on function public.others_availability(uuid) from anon, authenticated;
grant execute on function public.others_availability(uuid) to authenticated;
