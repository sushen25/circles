-- The backstop, at commit: a plan that is `confirmed` has an active
-- confirmation for its revision. `transition_plan` makes this true by
-- construction; this makes it impossible to be false by any other route.

create or replace function public.enforce_confirmed_has_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current public.plans;
begin
  -- Deferred to commit, so `new` is the row as it was when the update
  -- happened, not as it is now. A plan confirmed and then completed in one
  -- transaction (a seed, an outcome reported in the same call) has a
  -- confirmation that is `completed`, not `active`, and that is correct — the
  -- invariant is about the plan as it will be committed.
  select * into current from public.plans p where p.id = new.id;
  if current.state = 'confirmed' and not exists (
    select 1 from public.meetup_confirmations c
    where c.plan_id = current.id and c.revision = current.revision and c.status = 'active'
  ) then
    raise exception 'confirmed_without_confirmation' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_confirmed_has_confirmation() from public;
revoke all on function public.enforce_confirmed_has_confirmation() from anon, authenticated;
