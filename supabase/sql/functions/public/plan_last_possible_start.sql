-- ---------------------------------------------------------------------------
-- The deadline is never after the last possible start.
--
-- Architecture §8.2 lists it as a constraint on `plans`, and it cannot be a
-- `check`: the last possible start is a wall-clock time in the plan's zone, and
-- `at time zone` is stable rather than immutable — the tz database can change
-- under a stored row.
-- ---------------------------------------------------------------------------

create or replace function public.plan_last_possible_start(
  window_end date,
  daily_end_local integer,
  duration_minutes integer,
  time_zone text
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  -- Minutes added to midnight rather than a constructed time, so a band ending
  -- at 1440 rolls into the next day instead of failing to be a clock reading.
  select (
    plan_last_possible_start.window_end::timestamp
      + make_interval(mins => plan_last_possible_start.daily_end_local
                              - plan_last_possible_start.duration_minutes)
  ) at time zone plan_last_possible_start.time_zone;
$$;

comment on function public.plan_last_possible_start(date, integer, integer, text) is
  'The latest instant the meetup could still begin. Mirrors lastPossibleStart() in packages/domain/src/planning/deadline.ts.';

revoke all on function public.plan_last_possible_start(date, integer, integer, text) from public;
revoke all on function public.plan_last_possible_start(date, integer, integer, text)
  from anon, authenticated;
