create or replace function public.enforce_plan_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest_start timestamptz := public.plan_last_possible_start(
    new.window_end, new.daily_end_local, new.duration_minutes, new.time_zone
  );
begin
  if new.response_deadline > latest_start then
    raise exception 'response deadline % is after the last possible start %',
      new.response_deadline, latest_start
      using errcode = 'check_violation';
  end if;

  -- A quiet ask's stop time, while it is asking (spec §5.4, ADR 0035): set,
  -- and strictly before the last possible start — an ask that opened once
  -- nobody could meet would be an ask about nothing. Here and not in a check
  -- constraint for the reason above: the last possible start is a wall-clock
  -- time in the plan's zone, which is stable rather than immutable.
  --
  -- A `case` that answers `true` for a null stop time, not a comparison that
  -- answers null for one, because plpgsql's `if null` is `if false` and a
  -- quiet ask with no stop time would have walked straight through (SUS-24,
  -- SUS-49). Only while `seeking`: once it opens, the stop time is history and
  -- the plan runs to its deadline like any other. In parentheses because
  -- plpgsql reads an `if` condition up to its first `then`, and the `case`
  -- has one of its own.
  if (case
    when new.mode = 'quiet' and new.state = 'seeking' then
      new.quiet_expires_at is null or new.quiet_expires_at >= latest_start
    else false
  end) then
    raise exception 'stop_time_unavailable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_plan_deadline() is
  'A deadline never runs past the last possible start (spec §5.3), and a seeking quiet ask stops asking strictly before it (ADR 0035): replies that arrive once the plan cannot happen are replies to nothing.';

revoke all on function public.enforce_plan_deadline() from public;
revoke all on function public.enforce_plan_deadline() from anon, authenticated;
