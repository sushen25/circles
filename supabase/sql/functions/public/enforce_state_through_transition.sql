-- ---------------------------------------------------------------------------
-- Nothing else writes `state`.
--
-- Two mechanisms, because neither covers the other's case.
--
-- **A column privilege**: `update (state)` on `public.plans` is revoked from
-- `service_role` where the table is defined. That is the caller
-- the Edge Functions run as, and it is the one that matters: a `set_config`
-- marker is a *convention*, and any caller that can update the table can set it
-- first. Privileges cannot be manufactured by the code they restrain.
--
-- **The trigger**, for the case a privilege cannot reach: the table's owner,
-- which is `postgres` — migrations, psql, and `transition_plan` itself. The
-- marker is honest there, because at that point the caller is trusted and what
-- is being prevented is a mistake rather than an attack.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_state_through_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state
     and coalesce(current_setting('circles.in_transition', true), '') <> 'on' then
    raise exception 'plans.state is written only by planning.transition_plan()'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

comment on function public.enforce_state_through_transition() is
  'Refuses any update to plans.state from outside planning.transition_plan(), which sets circles.in_transition for the length of its own transaction.';

revoke all on function public.enforce_state_through_transition() from public;
revoke all on function public.enforce_state_through_transition() from anon, authenticated;
