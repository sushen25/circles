-- ---------------------------------------------------------------------------
-- The six views, to one pair of eyes.
--
-- The views themselves are owner-only. Nothing in the product reads them: the
-- founder diagnostics screen (S4-06) is the only consumer, and it goes through
-- this function so that "who may read the numbers" is one row in one table
-- rather than a grant on six objects that somebody will widen by accident.
--
-- In `public` rather than in `analytics`, where S1-21 first put it, because
-- PostgREST exposes `public` and nothing else: a definer function in
-- `analytics` granted to `authenticated` is a grant that reads like access and
-- is not — the screen could never call it — and `070_communication_jobs.sql`
-- refuses exactly that shape. The schema is where a caller can reach it; the
-- allowlist is what decides whether they may.
--
-- The allowlist is checked against `auth.uid()`, never against a parameter. A
-- function that takes the user it should authorise is a function that
-- authorises whoever calls it.
--
-- What comes back is aggregates — counts, medians, months. No circle is named
-- and no person appears: `funnel_by_circle` is keyed by circle id, which is
-- what lets a founder ask "which circle stalled" without this function being
-- the thing that says who is in it.
-- ---------------------------------------------------------------------------

create or replace function public.founder_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not exists (
    select 1 from private.allowlist a where a.user_id = caller
  ) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'funnel_by_circle', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.funnel_by_circle v),
    'plan_timings', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.plan_timings v),
    'reattach_rate', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.reattach_rate v),
    'nudge_conversion', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.nudge_conversion v),
    'north_star_monthly', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.north_star_monthly v),
    'chasing', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from analytics.chasing v)
  );
end;
$$;

comment on function public.founder_summary() is
  'Every analytics view, for a user in private.allowlist and nobody else. The allowlist is checked against auth.uid(); the views themselves are owner-only.';

revoke all on function public.founder_summary() from public;
revoke all on function public.founder_summary() from anon;
grant execute on function public.founder_summary() to authenticated;
