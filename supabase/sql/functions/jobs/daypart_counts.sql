-- The counts a set of responses contributes — computed over the windows that
-- are about to go, and *added* to what the summary already holds. The
-- summary is a running total across retention runs: a member whose answers
-- cross the twelve-month line on different nights must not end up with only
-- the last of them.

create or replace function jobs.daypart_counts(p_response_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with parts as (
    select
      case when extract(isodow from (w.starts_at at time zone p.time_zone)::date) in (6, 7)
        then 'weekend' else 'weekday' end as prefix,
      extract(hour from (w.starts_at at time zone p.time_zone))::integer * 60
        + extract(minute from (w.starts_at at time zone p.time_zone))::integer as start_min,
      case
        when (w.ends_at at time zone p.time_zone)::date = (w.starts_at at time zone p.time_zone)::date
        then extract(hour from (w.ends_at at time zone p.time_zone))::integer * 60
          + extract(minute from (w.ends_at at time zone p.time_zone))::integer
        else extract(hour from (w.ends_at at time zone p.time_zone))::integer * 60
          + extract(minute from (w.ends_at at time zone p.time_zone))::integer + 1440
      end as end_min
    from public.willing_windows w
    join public.plan_responses r on r.id = w.response_id
    join public.plans p on p.id = r.plan_id
    where r.id = any (p_response_ids) and r.status = 'windows'
  ),
  bands (part, band_start, band_end) as (
    values ('morning', 0, 720), ('afternoon', 720, 1020), ('evening', 1020, 1440)
  ),
  covered as (
    select parts.prefix || '_' || bands.part as daypart
    from parts
    join bands on parts.start_min < bands.band_end and parts.end_min > bands.band_start
  ),
  all_parts (daypart, ordinal) as (
    values ('weekday_morning', 1), ('weekday_afternoon', 2), ('weekday_evening', 3),
           ('weekend_morning', 4), ('weekend_afternoon', 5), ('weekend_evening', 6)
  )
  select jsonb_object_agg(a.daypart, coalesce(c.n, 0) order by a.ordinal)
  from all_parts a
  left join (select daypart, count(*)::integer as n from covered group by daypart) c on c.daypart = a.daypart;
$$;

comment on function jobs.daypart_counts(uuid[]) is
  'How many of the given responses'' windows cover each of the six dayparts, by dayPartsCovered()''s rule.';

revoke all on function jobs.daypart_counts(uuid[]) from public;
revoke all on function jobs.daypart_counts(uuid[]) from anon, authenticated;
