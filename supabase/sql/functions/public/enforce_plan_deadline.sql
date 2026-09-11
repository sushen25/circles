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
  return new;
end;
$$;

comment on function public.enforce_plan_deadline() is
  'A deadline never runs past the last possible start (spec §5.3): replies that arrive once the plan cannot happen are replies to nothing.';

revoke all on function public.enforce_plan_deadline() from public;
revoke all on function public.enforce_plan_deadline() from anon, authenticated;
