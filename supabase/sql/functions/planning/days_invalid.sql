-- ---------------------------------------------------------------------------
-- Whether a list of days is not a plan's days (ADR 0047): the one check
-- `create_plan` and `revise_plan` both make, so they cannot disagree, and the
-- database's half of the domain's `windowError`.
--
-- A list is good when it is sorted, distinct, holds no null, and starts and
-- ends on the window's ends. Null itself is "no list" and is not invalid.
-- Every comparison is null-safe and the whole is coalesced: a null inside the
-- list made the plain comparisons null, plpgsql read `if null` as false, and a
-- crafted call slipped a day in through a `narrow` (review round 2).
-- ---------------------------------------------------------------------------

create or replace function planning.days_invalid(p_days date[], p_start date, p_end date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_days is not null and coalesce(
    cardinality(p_days) = 0
    or array_position(p_days, null) is not null
    or p_days is distinct from (select array_agg(distinct d order by d) from unnest(p_days) d)
    or p_days[1] is distinct from p_start
    or p_days[cardinality(p_days)] is distinct from p_end,
    true
  );
$$;

comment on function planning.days_invalid(date[], date, date) is
  'True when a list of days is not sorted, distinct and null-free, or does not start and end on the window''s ends (ADR 0047). Null is no list, and not invalid.';

revoke all on function planning.days_invalid(date[], date, date) from public;
revoke all on function planning.days_invalid(date[], date, date) from anon, authenticated;
