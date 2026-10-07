-- 0042_previous_dayparts
--
-- `public.previous_dayparts(p_plan_id)`: the day-parts the caller has offered in
-- earlier answers with times in this plan's circle (and in the stored
-- `member_dayparts` counts), limited to the parts this plan asks about, as text
-- and never a window (SUS-159, ADR 0037's amendment). "Use my previous times"
-- reads it in one request, from the first repeat, painting every part offered.
-- A reader of the caller's own rows only: `auth.uid()`, active members of the
-- plan's circle, execute for `authenticated`. No table, column or policy
-- changes.

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/previous_dayparts.sql
-- ---------------------------------------------------------------------------
-- The day-parts the caller has offered before, in the parts this plan asks
-- about: "Use my previous times" (SUS-159, ADR 0037's amendment).
--
-- Read, not written: nothing is stored when somebody answers. A part is
-- returned when the caller offered it in any earlier answer with times in this
-- circle, or when `member_dayparts` holds a count for it (the windows
-- retention has already deleted). One earlier answer is enough, and a part
-- offered once counts as much as one offered every time, so the question "was
-- this part ever offered?" is all the database has to answer, and the client
-- is handed at most six strings and no window.
--
-- **Whose data this reads.** Only the caller's own: the member is
-- `auth.uid()` and is never a parameter, every response read is filtered to
-- it, and `member_dayparts` is read at (this circle, the caller). The caller
-- must be an active member of the plan's circle; for anybody else, and for a
-- plan that does not exist, the answer is the empty array, which does not say
-- which it was. Another member's windows, and anything from another circle,
-- are never counted. It is a definer function only because RLS offers no way
-- to say "the day-part, not the window"; the rows it opens are the caller's.
--
-- The day-part rule is `jobs.daypart_counts`, the one SQL copy, which is
-- classed in each window's *own* plan's zone and pinned to `dayPartsCovered`.
-- Only the caller's latest revision of each *other* plan's answer counts: an
-- edit asks again, and the answer to the question as it was is not a second
-- offer. The plan's own answer is not counted.
--
-- The parts the plan asks about come from its dates (`plan_days` when it has
-- gaps, every day from `window_start` to `window_end` otherwise: weekday or
-- weekend by the local date) and its daily hours against the bands
-- 0-720, 720-1020, 1020-1440, as `dayPartsCovered` has them.
-- ---------------------------------------------------------------------------

create or replace function public.previous_dayparts(p_plan_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select p.id, p.circle_id, p.window_start, p.window_end, p.daily_start_local, p.daily_end_local
    from public.plans p
    join public.circle_members me
      on me.circle_id = p.circle_id
     and me.user_id = (select auth.uid())
     and me.status = 'active'
    where p.id = p_plan_id
  ),
  days as (
    select d.day
    from plan
    join public.plan_days d on d.plan_id = plan.id
    union
    select plan.window_start + g
    from plan, generate_series(0, plan.window_end - plan.window_start) g
    where not exists (select 1 from public.plan_days d where d.plan_id = plan.id)
  ),
  bands (part, band_start, band_end) as (
    values ('morning', 0, 720), ('afternoon', 720, 1020), ('evening', 1020, 1440)
  ),
  asked as (
    select distinct
      case when extract(isodow from days.day) in (6, 7) then 'weekend' else 'weekday' end
        || '_' || bands.part as daypart
    from plan
    cross join days
    join bands on plan.daily_start_local < bands.band_end and plan.daily_end_local > bands.band_start
  ),
  mine as (
    select distinct on (r.plan_id) r.id
    from plan
    join public.plan_responses r
      on r.user_id = (select auth.uid())
     and r.plan_id <> plan.id
    join public.plans earlier on earlier.id = r.plan_id and earlier.circle_id = plan.circle_id
    order by r.plan_id, r.revision desc
  ),
  totals as (
    select jobs.add_daypart_counts(
      jobs.daypart_counts(coalesce((select array_agg(id) from mine), array[]::uuid[])),
      coalesce(
        (select s.summary -> 'counts'
         from plan
         join public.member_dayparts s
           on s.circle_id = plan.circle_id and s.user_id = (select auth.uid())),
        '{}'::jsonb
      )
    ) as counts
  ),
  ordered (daypart, ordinal) as (
    values ('weekday_morning', 1), ('weekday_afternoon', 2), ('weekday_evening', 3),
           ('weekend_morning', 4), ('weekend_afternoon', 5), ('weekend_evening', 6)
  )
  select coalesce(
    (select array_agg(o.daypart order by o.ordinal)
     from ordered o
     join asked a on a.daypart = o.daypart
     where coalesce((select t.counts ->> o.daypart from totals t)::integer, 0) > 0),
    array[]::text[]
  );
$$;

comment on function public.previous_dayparts(uuid) is
  'The day-parts the caller has offered in any earlier answer with times in this plan''s circle, or in the stored summary, limited to the parts this plan asks about; text only, never a window. The caller is auth.uid() and must be an active member of the circle; for anybody else the answer is the empty array.';

revoke all on function public.previous_dayparts(uuid) from public;
revoke all on function public.previous_dayparts(uuid) from anon, authenticated;
grant execute on function public.previous_dayparts(uuid) to authenticated;

-- END GENERATED: function definitions
