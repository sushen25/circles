-- ---------------------------------------------------------------------------
-- The first plans that may be owed the founder's "want a hand?" letter
-- (SUS-240, ADR 0085).
--
-- A coarse superset, as `dispatch_timed_work` is for the cadence nudge: the
-- circles' **first named plan**, still asking, made at least 48 hours ago, in
-- an active circle that has never been sent the letter (no row in
-- `private.first_plan_quiet_letters`), with an organiser. Each comes with the
-- facts the domain's rule needs (`firstPlanQuiet`) and nothing else: when it
-- was made, in epoch milliseconds, and how many people other than its organiser
-- have answered it on any revision. Whether the letter is owed, to whom and
-- when is the domain's and the dispatcher's. No name, address or plan code.
--
-- Oldest first, so a plan that has waited longest is looked at first.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_first_plan_quiet_candidates(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'plan_id', x.id,
    'created_ms', x.created_ms
  ) order by x.created_at, x.id), '[]'::jsonb)
  from (
    select
      p.id,
      p.created_at,
      (extract(epoch from p.created_at) * 1000)::bigint as created_ms
    from public.plans p
    join public.circles c on c.id = p.circle_id
    where p.mode = 'named'
      and p.state in ('collecting', 'ready')
      and p.organiser_user_id is not null
      and p.created_at <= now() - interval '48 hours'
      and c.status = 'active'
      and p.id = (
        select f.id from public.plans f
        where f.circle_id = p.circle_id and f.mode = 'named'
        order by f.created_at, f.id
        limit 1
      )
      and not exists (
        select 1 from public.plan_responses r
        where r.plan_id = p.id and r.user_id is distinct from p.organiser_user_id
      )
      and not exists (
        select 1 from private.first_plan_quiet_letters l where l.circle_id = p.circle_id
      )
    order by p.created_at, p.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x;
$$;

comment on function public.dispatch_first_plan_quiet_candidates(integer) is
  'The circles'' first named plans that are still asking, 48 hours old or more, nobody but their organiser has answered, in an active circle never sent the founder''s first_plan_quiet letter: plan id and when it was made (ms). A superset; the domain decides. Service role only (SUS-240, ADR 0085).';

revoke all on function public.dispatch_first_plan_quiet_candidates(integer) from public;
revoke all on function public.dispatch_first_plan_quiet_candidates(integer) from anon, authenticated;
grant execute on function public.dispatch_first_plan_quiet_candidates(integer) to service_role;
