-- `summariseDayparts()`'s shape from a set of counts: the parts most offered
-- first, ties in the fixed order.

create or replace function jobs.daypart_summary(p_counts jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with all_parts (daypart, ordinal) as (
    values ('weekday_morning', 1), ('weekday_afternoon', 2), ('weekday_evening', 3),
           ('weekend_morning', 4), ('weekend_afternoon', 5), ('weekend_evening', 6)
  ),
  counted as (
    select a.daypart, a.ordinal, coalesce((p_counts ->> a.daypart)::integer, 0) as n
    from all_parts a
  )
  select jsonb_build_object(
    'parts', coalesce((select jsonb_agg(daypart order by n desc, ordinal) from counted where n > 0), '[]'::jsonb),
    'counts', (select jsonb_object_agg(daypart, n order by ordinal) from counted)
  );
$$;

comment on function jobs.daypart_summary(jsonb) is
  'The stored shape — {parts, counts} — from a set of counts, as summariseDayparts() orders them.';

revoke all on function jobs.daypart_summary(jsonb) from public;
revoke all on function jobs.daypart_summary(jsonb) from anon, authenticated;
