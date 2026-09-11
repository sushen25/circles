-- Alignment is judged in the **plan's zone**, not UTC. The ticket's sketch had
-- `extract(minute from starts_at at time zone 'UTC') in (0, 30)`, and that is
-- wrong for every zone that is not a whole hour off UTC: Kathmandu is +05:45,
-- so a window painted 09:00–10:00 there is 03:15–04:15 UTC and would have been
-- refused, while 09:15 local would have passed. S1-03 hit exactly this in the
-- domain, and the database has to agree with it.

create or replace function public.enforce_window_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  response public.plan_responses;
  plan public.plans;
  local_start timestamp;
  local_end timestamp;
  day date;
  day_band_start timestamp;
  day_band_end timestamp;
begin
  select * into response from public.plan_responses r where r.id = new.response_id;
  select * into plan from public.plans p where p.id = response.plan_id;

  -- Windows belong to a `windows` answer and nothing else: a `not_this_time`
  -- with a window attached would be availability the person had withdrawn.
  if response.status <> 'windows' then
    raise exception 'a % response carries no windows', response.status
      using errcode = 'check_violation';
  end if;

  local_start := new.starts_at at time zone plan.time_zone;
  local_end := new.ends_at at time zone plan.time_zone;

  if extract(minute from local_start)::integer % 30 <> 0
     or extract(second from local_start) <> 0
     or extract(minute from local_end)::integer % 30 <> 0
     or extract(second from local_end) <> 0 then
    raise exception 'window %–% is not on a half hour in %', new.starts_at, new.ends_at, plan.time_zone
      using errcode = 'check_violation';
  end if;

  -- Inside the plan: the whole window fits the band of the day it starts on.
  -- Judged on the local clock so the day the clocks change reads the way the
  -- person saw it, and the band end may be 1440 — midnight, which rolls into
  -- the next date and is why the end is compared as an instant rather than as
  -- minutes-of-day.
  --
  -- One day, deliberately. The first version checked the end only when it fell
  -- on the same date as the start, so 18:30 Thursday to 20:30 Friday sailed
  -- through with the whole night inside it — availability the person never
  -- painted, which the engine would then have offered. The domain's
  -- `isWithinPlan` is containment in one day's band; this is the same rule.
  day := local_start::date;
  day_band_start := day::timestamp + make_interval(mins => plan.daily_start_local);
  day_band_end := day::timestamp + make_interval(mins => plan.daily_end_local);
  if day < plan.window_start or day > plan.window_end
     or local_start < day_band_start or local_end > day_band_end then
    raise exception 'window %–% lies outside the plan''s daily band', new.starts_at, new.ends_at
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_window_shape() is
  'Half-hour aligned in the plan''s zone, inside the plan''s window and band, and attached to a `windows` response. Mirrors normaliseWindows() in packages/domain/src/availability/windows.ts.';

revoke all on function public.enforce_window_shape() from public;
revoke all on function public.enforce_window_shape() from anon, authenticated;
