-- ---------------------------------------------------------------------------
-- Supersede on reschedule; cancel on cancel.
--
-- A trigger on `plans`, so that leaving `confirmed` by any transition takes
-- the active confirmation with it in the same statement. `transition_plan`
-- need not know confirmations exist, and there is no window in which a plan is
-- back in `collecting` with a confirmation still `active`.
-- ---------------------------------------------------------------------------

create or replace function public.supersede_on_leaving_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state <> 'confirmed' or new.state = 'confirmed' then
    return new;
  end if;

  -- `reopen` bumps the revision and goes to collecting; `cancel` goes to
  -- cancelled. `report_outcome` goes to completed, and `apply_outcome` has
  -- normally closed the confirmation already with the outcome's own status —
  -- but a `report_outcome` applied directly, without a report, must not leave a
  -- completed plan with an active confirmation, so this closes it too.
  update public.meetup_confirmations c
  set status = case new.state when 'cancelled' then 'cancelled' when 'completed' then 'completed' else 'superseded' end,
      superseded_at = now(),
      superseded_reason = case new.state when 'cancelled' then 'cancel' when 'completed' then 'outcome' else 'reopen' end
  where c.plan_id = new.id
    and c.revision = old.revision
    and c.status = 'active';

  return new;
end;
$$;

comment on function public.supersede_on_leaving_confirmed() is
  'Reschedule supersedes, cancel cancels, never mutates (architecture §6.2). Mirrors supersede() in the domain.';

revoke all on function public.supersede_on_leaving_confirmed() from public;
revoke all on function public.supersede_on_leaving_confirmed() from anon, authenticated;
