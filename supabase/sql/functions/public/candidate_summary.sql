-- ---------------------------------------------------------------------------
-- Where a plan stands, in the three words a screen has for it.
--
-- Spec §5.6 gives the candidates screen three states and only two of them are
-- plan states: `ready` has options, `no_quorum` has near-misses and the one
-- rule that blocked them, and `collecting` is the waiting state — "members see
-- nothing until options exist". The difference between the last two is whether
-- the engine has found anything to be close to, which is a fact about the set
-- rather than about the plan. `closed` is the fourth answer, for a plan that has
-- been confirmed, cancelled or expired: no screen shows candidates for one, and
-- a caller that asked about it should not be told "collecting".
--
-- Derived in one place because two callers need the same answer —
-- `store_candidate_set` returns it whether it stored anything or not — and a
-- summary that disagreed with itself depending on which branch produced it
-- would be worse than none.
-- ---------------------------------------------------------------------------

create or replace function public.candidate_summary(plan public.plans, p_stored boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select cs.id, cs.eligible_count,
      (select count(*) from public.candidates c
       where c.candidate_set_id = cs.id and c.is_near_miss) as near_misses
    from public.candidate_sets cs
    where cs.plan_id = plan.id
      and cs.revision = plan.revision
      and cs.input_version = plan.input_version
  )
  select jsonb_build_object(
    'stored', p_stored,
    'candidate_set_id', (select id from live),
    -- Which version of the plan this describes. The caller has just moved it —
    -- an answer bumps `input_version` — and reading it back out of the same
    -- answer saves a second round trip to ask what it became.
    'input_version', plan.input_version,
    'state', case
      when plan.state = 'ready' then 'ready'
      -- Anything that is not collecting availability is `closed` to this
      -- screen, and that includes a quiet ask still `seeking` and a plan still
      -- in `draft`: nothing is being collected for either, and answering
      -- "collecting" about one would be the screen waiting for replies nobody
      -- has been asked for.
      when plan.state <> 'collecting' then 'closed'
      when coalesce((select near_misses from live), 0) > 0 then 'no_quorum'
      else 'collecting'
    end,
    'eligible', coalesce((select eligible_count from live), 0),
    'near_misses', coalesce((select near_misses from live), 0)
  );
$$;

comment on function public.candidate_summary(public.plans, boolean) is
  'Where a plan stands for the candidates screen — ready, no_quorum, collecting or closed — with the set that is current for it. Service role only; clients read candidate_sets directly under RLS.';

revoke all on function public.candidate_summary(public.plans, boolean) from public;
revoke all on function public.candidate_summary(public.plans, boolean) from anon, authenticated;
grant execute on function public.candidate_summary(public.plans, boolean) to service_role;
