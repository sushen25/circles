-- ---------------------------------------------------------------------------
-- Taking the organiser role on a quiet plan that has none (spec §5.4.5,
-- architecture §9.1 `accept-organiser`).
--
-- `acceptOrganiser` in `packages/domain/src/planning/quiet-lifecycle.ts`,
-- with the source worked out here rather than said by the caller:
--
--   * the **initiator** — their private "I'll organise";
--   * a **volunteer** — any keen member's "I'll pick the time";
--   * the **owner's fallback** — the circle owner, once replies have closed
--     with nobody in the role.
--
-- The first two need nothing more than the answer on record: the initiator's
-- keen row is written when they ask, so "keen" covers both, and which of the
-- two somebody is decides nothing. The third waits for the response deadline,
-- which is the rule the table's `keen_initiator_or_owner` guard cannot carry —
-- it has to admit the owner at any time, or the nudge would lead nowhere — and
-- so it is here (SUS-49 note 10).
--
-- **The source is never stored, returned, logged or put in an event.** The
-- organiser's name is public from here on (§4.5); how they came to it is not,
-- because `initiator` next to that name *is* the initiator. `transition_plan`
-- emits `planning.organiser_accepted` with the plan and the organiser and
-- nothing else, and this function returns the plan row, which has no column
-- that could say.
--
-- **First writer wins.** The plan row is locked before anything is read, so
-- two acceptances arriving together are decided one after the other and the
-- second finds the role taken (`already_taken`). The machine's
-- `no_organiser_yet` guard says the same thing again and is the authority.
--
-- Refusals are about the caller and only the caller: `requires_saved_place`
-- (a guest, ADR 0004 — the organiser role belongs to saved places only),
-- `not_keen` (answered "not this time", or never answered, and not the owner),
-- `deadline_not_passed` (the owner, not keen, before replies close).
-- ---------------------------------------------------------------------------

create or replace function public.accept_organiser(p_plan_id uuid)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
begin
  if caller is null then
    raise exception 'accept_organiser requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = caller and m.status = 'active'
  ) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  if plan.mode <> 'quiet' then
    raise exception 'not_quiet' using errcode = 'P0001';
  end if;

  if plan.state in ('completed', 'expired', 'cancelled') then
    raise exception 'plan_is_finished' using errcode = 'P0001';
  end if;
  -- Only once it has opened: the role is offered to a plan people are known
  -- to want, never to an ask still gathering interest.
  if plan.state not in ('collecting', 'ready') then
    raise exception 'wrong_state' using errcode = 'P0001';
  end if;

  if not coalesce((select pr.is_permanent from public.profiles pr where pr.user_id = caller), false) then
    raise exception 'requires_saved_place' using errcode = 'P0001';
  end if;

  if plan.organiser_user_id is not null then
    raise exception 'already_taken' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from private.plan_interest i
    where i.plan_id = plan.id and i.user_id = caller and i.response = 'keen'
  ) and not exists (
    select 1 from private.plan_initiators pi
    where pi.plan_id = plan.id and pi.initiator_user_id = caller
  ) then
    if not exists (
      select 1 from public.circles c where c.id = plan.circle_id and c.owner_user_id = caller
    ) then
      raise exception 'not_keen' using errcode = 'P0001';
    end if;
    if now() < plan.response_deadline then
      raise exception 'deadline_not_passed' using errcode = 'P0001';
    end if;
  end if;

  return planning.transition_plan(plan.id, 'accept_organiser', caller);
end;
$$;

comment on function public.accept_organiser(uuid) is
  'The calling member takes the organiser role on an opened quiet plan with none: a keen member or the initiator at any time, the circle owner once replies have closed. First writer wins. How they came to it is never recorded (S2-02).';

revoke all on function public.accept_organiser(uuid) from public;
revoke all on function public.accept_organiser(uuid) from anon, authenticated;
grant execute on function public.accept_organiser(uuid) to authenticated;
