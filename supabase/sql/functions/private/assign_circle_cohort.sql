-- ---------------------------------------------------------------------------
-- Which cohort a new circle belongs to (SUS-178, ADR 0058).
--
-- Spec §11.4 judges the founder's test circles and the external cohort against
-- different gates, so every circle carries a cohort and nobody but the founder
-- can read or change it. The rule at creation: a circle whose owner is on the
-- founder allowlist (`private.allowlist`, the one `founder_analytics` checks) is
-- `founder`; every other circle is `external`. Run as the owner, because
-- neither table is reachable by the user who is creating the circle.
--
-- A trigger on `circles` rather than a line in `create_circle`, so a circle
-- made any other way (the seed, a restore, a future writer) cannot be left
-- without one.
-- ---------------------------------------------------------------------------
create or replace function private.assign_circle_cohort()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.circle_cohorts (circle_id, cohort)
  values (
    new.id,
    case
      when exists (select 1 from private.allowlist a where a.user_id = new.owner_user_id)
        then 'founder'
      else 'external'
    end
  )
  on conflict (circle_id) do nothing;
  return new;
end;
$$;

revoke all on function private.assign_circle_cohort() from public;
revoke all on function private.assign_circle_cohort() from anon, authenticated;
