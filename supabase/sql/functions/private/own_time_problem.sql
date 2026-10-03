-- ---------------------------------------------------------------------------
-- What is wrong with a stretch the organiser wants to lock in, if anything
-- (ADR 0051).
--
-- `ownTimeProblem` in `packages/domain`, rule for rule and in the same order:
-- shape before the clock, so a stretch that is off the half hour is wrong
-- whenever it is. Returns the refusal code, or null when it is a valid own
-- time. The codes are the domain's, so a client can tell somebody what was
-- wrong, and the database refuses what the screen should never have sent.
--
--   * both ends on a half hour on the plan's clock, with no seconds;
--   * it ends after it starts, and lasts from 30 minutes to 5 hours;
--   * it starts in the future;
--   * it starts no later than the plan's last day plus thirty, on the plan's
--     clock rather than UTC.
-- ---------------------------------------------------------------------------

create or replace function private.own_time_problem(
  p_plan public.plans,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  minutes numeric;
begin
  if p_starts_at is null or p_ends_at is null then
    return 'needs_own_time';
  end if;

  if extract(second from (p_starts_at at time zone p_plan.time_zone)) <> 0
     or extract(second from (p_ends_at at time zone p_plan.time_zone)) <> 0
     or extract(minute from (p_starts_at at time zone p_plan.time_zone))::integer % 30 <> 0
     or extract(minute from (p_ends_at at time zone p_plan.time_zone))::integer % 30 <> 0 then
    return 'own_time_off_the_half_hour';
  end if;

  if p_ends_at <= p_starts_at then
    return 'own_time_ends_before_it_starts';
  end if;

  minutes := extract(epoch from (p_ends_at - p_starts_at)) / 60;
  if minutes < 30 then
    return 'own_time_too_short';
  end if;
  if minutes > 300 then
    return 'own_time_too_long';
  end if;

  if p_starts_at <= now() then
    return 'own_time_in_the_past';
  end if;

  if (p_starts_at at time zone p_plan.time_zone)::date > p_plan.window_end + 30 then
    return 'own_time_too_far_ahead';
  end if;

  return null;
end;
$$;

comment on function private.own_time_problem(public.plans, timestamptz, timestamptz) is
  'The first thing wrong with a stretch the organiser wants to lock in, as ownTimeProblem has it in the domain, or null (ADR 0051).';

revoke all on function private.own_time_problem(public.plans, timestamptz, timestamptz) from public;
revoke all on function private.own_time_problem(public.plans, timestamptz, timestamptz) from anon, authenticated;
grant execute on function private.own_time_problem(public.plans, timestamptz, timestamptz) to service_role;
