-- ---------------------------------------------------------------------------
-- Whether a plan's code may still be used to Continue-as in its circle
-- (ADR 0049, ADR 0059).
--
-- The one statement of the rule. `private.circles_open_to_continue_as` asks it
-- of the plan a code names; `public.reattach_member` asks it of the circle a
-- membership is in, because the list path takes a circle and a member and
-- no code, and a caller who remembered both would otherwise need no code at all.
--
-- Live means the circle is `active` and the plan is `collecting` or `ready`, or
-- `confirmed` or `completed` with a confirmation (active or completed) whose
-- meetup ended less than `private.continue_as_window()` ago.
-- ---------------------------------------------------------------------------

create or replace function private.plan_live_for_continue_as(p_plan_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.plans pl
    join public.circles c on c.id = pl.circle_id
    where pl.id = p_plan_id
      and c.status = 'active'
      and (
        pl.state in ('collecting', 'ready')
        or (
          pl.state in ('confirmed', 'completed')
          and exists (
            select 1 from public.meetup_confirmations mc
            where mc.plan_id = pl.id
              and mc.revision = pl.revision
              and mc.status in ('active', 'completed')
              and now() < mc.ends_at + private.continue_as_window()
          )
        )
      )
  );
end;
$$;

revoke all on function private.plan_live_for_continue_as(uuid) from public;
revoke all on function private.plan_live_for_continue_as(uuid) from anon, authenticated;
