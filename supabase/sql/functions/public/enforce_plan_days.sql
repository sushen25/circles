-- ---------------------------------------------------------------------------
-- A plan's listed days agree with its window (ADR 00ZZ).
--
-- `plan_days` holds the days a plan asks about **only when it has gaps**. No
-- rows means every day from `window_start` to `window_end`, which is every
-- preset and every plan stored before a plan could have gaps — so nothing had
-- to be backfilled and the four presets write nothing here. Rows, when there
-- are any, are the days: the first is `window_start`, the last is
-- `window_end`, and at least one day between them is missing, so one set of
-- days has one way to be stored.
--
-- A deferred constraint trigger on both tables rather than a check on either,
-- because the rule is about the two together and `revise_plan` moves them in
-- two statements: the window first, through `transition_plan`, and then the
-- rows. Checked once, at commit, on whatever the transaction left behind.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_plan_days()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target uuid;
  plan public.plans;
  first_day date;
  last_day date;
  listed integer;
begin
  if tg_table_name = 'plans' then
    target := new.id;
  elsif tg_op = 'DELETE' then
    target := old.plan_id;
  else
    target := new.plan_id;
  end if;

  select * into plan from public.plans p where p.id = target;
  -- The plan has gone, and its rows went with it (`on delete cascade`).
  if not found then
    return null;
  end if;

  select min(d.day), max(d.day), count(*)::integer into first_day, last_day, listed
  from public.plan_days d where d.plan_id = target;

  if listed = 0 then
    return null;
  end if;

  if first_day <> plan.window_start or last_day <> plan.window_end then
    raise exception 'days_invalid: the days of plan % run % to %, its window % to %',
      target, first_day, last_day, plan.window_start, plan.window_end
      using errcode = 'check_violation';
  end if;

  if listed = (plan.window_end - plan.window_start) + 1 then
    raise exception 'days_invalid: plan % lists every day of its window; no rows means that',
      target
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function public.enforce_plan_days() is
  'Deferred: a plan''s listed days start and end on its window''s ends and leave at least one day out; no rows means every day (ADR 00ZZ).';

revoke all on function public.enforce_plan_days() from public;
revoke all on function public.enforce_plan_days() from anon, authenticated;
