-- ---------------------------------------------------------------------------
-- Where a plan stands, asked about the plan rather than handed one.
--
-- `candidate_summary` takes a `public.plans` row because its callers already
-- hold one under a lock. This is for the caller that does not: the Edge
-- Function's path where the recalculation itself failed, and the answer that
-- prompted it has nonetheless been stored (ADR 0018). Reporting an error for a
-- request that worked would be false, so the endpoint says where the plan is —
-- and it needs a way to ask that does not involve running the engine again.
-- ---------------------------------------------------------------------------

create or replace function public.plan_candidate_summary(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.candidate_summary(p, false) from public.plans p where p.id = p_plan_id;
$$;

comment on function public.plan_candidate_summary(uuid) is
  'Where a plan stands for the candidates screen, by plan id. Service role only; the summary reports nothing a member could not read from candidate_sets.';

revoke all on function public.plan_candidate_summary(uuid) from public;
revoke all on function public.plan_candidate_summary(uuid) from anon, authenticated;
grant execute on function public.plan_candidate_summary(uuid) to service_role;
