-- ---------------------------------------------------------------------------
-- Who a stretch of time works for, for the organiser choosing one
-- (ADR 0051).
--
-- The picker, the review screen and the edit screen say it by name before
-- anything is locked in: "You, Priya and Tom can make it · Doesn't work for Jess
-- or Sam · Alex hasn't answered". That is what the candidate cards already say
-- for the options, asked of any stretch. `private.stretch_availability` is the
-- rule, `whoCanMake` in the domain, and the freeze in `confirm_own_time` reads
-- the same function, so what the organiser sees is what would be frozen.
--
-- **The organiser alone**: a member who is not the organiser is told the plan has
-- an organiser who is not them, and a stranger is told the plan is not there,
-- as `confirm_meetup` does. It returns ids and the plan's `input_version` and
-- revision as they are now, which the confirmation later compares under the
-- lock (`stale_availability`): the answer is only as current as its version.
-- Never a window, never a status.
--
-- Open to any stretch, valid or not: it is a question, not an act, and the
-- act is refused for the same stretch by `private.own_time_problem`.
-- ---------------------------------------------------------------------------

create or replace function public.stretch_availability(
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
begin
  if caller is null then
    raise exception 'stretch_availability requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id;
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;
  -- Where an organiser may set a time, and look at one they have set.
  if plan.state not in ('collecting', 'ready', 'confirmed') then
    raise exception 'wrong_state' using errcode = 'P0001';
  end if;

  return private.stretch_availability(plan.id, p_starts_at, p_ends_at)
    || jsonb_build_object('input_version', plan.input_version, 'revision', plan.revision);
end;
$$;

comment on function public.stretch_availability(uuid, timestamptz, timestamptz) is
  'For the plan''s organiser: who of the people the plan is asking can make a stretch, who answered otherwise and who has not, with the plan''s input version and revision. Ids only (ADR 0051).';

revoke all on function public.stretch_availability(uuid, timestamptz, timestamptz) from public;
revoke all on function public.stretch_availability(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.stretch_availability(uuid, timestamptz, timestamptz) to authenticated;
