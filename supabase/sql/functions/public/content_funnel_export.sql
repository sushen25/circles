-- ---------------------------------------------------------------------------
-- The funnel by campaign tag, for the content loop (SUS-244, ADR 0087).
--
-- The `by_source_ref` and `stalled` blocks of `founder_analytics` (SUS-240,
-- ADR 0084), read by a script instead of a person: the `content-funnel` Edge
-- Function calls this with the service client, behind a secret of its own.
-- Both doors read `private.funnel_by_tag`, so there is one definition of the
-- numbers. Here the stalled first plans are only those whose owner's source is
-- `content`; the founder screen sees every source.
--
-- **Counts and ages, and nothing finer.** Per tag: the circle row counters and
-- the totals of `plan_shared`, `availability_submitted` and `meetup_confirmed`.
-- Per stalled group: the week, cohort, source, state, how many circles and how
-- long they have been stopped. No circle, plan, member, short code, uuid, name
-- or address. A tag labels a post and never a person.
--
-- In `public` although the numbers are in `analytics`: PostgREST exposes
-- `public` and no other schema, and the Edge Function reaches this over HTTP
-- (see `take_rate_token`). A `public` function granted to `service_role` alone
-- widens nothing; `anon` and `authenticated` are refused with 42501.
--
-- The period is clamped as `founder_analytics` clamps it: to the Monday of the
-- week `p_since` falls in, and no further back than 400 days. The answer says
-- from when it is.
-- ---------------------------------------------------------------------------
create or replace function public.content_funnel_export(p_since date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_tags jsonb;
begin
  if p_since is null then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_from := date_trunc('week', greatest(p_since, current_date - 400))::date;
  v_tags := private.funnel_by_tag(v_from, 'content');

  return jsonb_build_object(
    'since', v_from,
    'by_source_ref', v_tags -> 'by_source_ref',
    'stalled', v_tags -> 'stalled'
  );
end;
$$;

comment on function public.content_funnel_export(date) is
  'The content loop''s read of the funnel by campaign tag, from the Monday of p_since''s week: { since, by_source_ref, stalled }, the stalled first plans only for source content. Counts and ages: no circle, plan, member, code, id or name. Service role only (ADR 0087); the content-funnel Edge Function is the one caller.';

revoke all on function public.content_funnel_export(date) from public;
revoke all on function public.content_funnel_export(date) from anon, authenticated;
grant execute on function public.content_funnel_export(date) to service_role;
