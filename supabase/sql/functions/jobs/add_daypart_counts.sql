create or replace function jobs.add_daypart_counts(p_a jsonb, p_b jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_object_agg(k, coalesce((p_a ->> k)::integer, 0) + coalesce((p_b ->> k)::integer, 0))
  from unnest(array[
    'weekday_morning', 'weekday_afternoon', 'weekday_evening',
    'weekend_morning', 'weekend_afternoon', 'weekend_evening'
  ]) as k;
$$;

revoke all on function jobs.add_daypart_counts(jsonb, jsonb) from public;
revoke all on function jobs.add_daypart_counts(jsonb, jsonb) from anon, authenticated;
