-- ---------------------------------------------------------------------------
-- Who an edit would cost, as facts. The rule that turns them into a warning is
-- `invalidatedResponses` in `packages/domain`, and there is only one of it.
--
-- Spec §5.3: an edit that invalidates responses "shows, **before saving**,
-- exactly who will be asked again". The client cannot work that out — a member
-- may read only their *own* response (`plan_responses_select_own`), which is
-- the whole point of that policy — so the server has to say. This returns the
-- two lists the domain function takes and nothing else: who the plan was
-- addressed to, and which of them have answered the revision that is current.
--
-- Not the answers themselves. Whether Priya said yes is hers; *that* she
-- answered is what the organiser is about to take away from her, and is the
-- only part of it this discloses.
--
-- Organiser-only, because `edit` is (`planning.transitions`), and a preview of
-- an edit somebody cannot make is a roster they should not have.
--
-- In `public`, although it is planning's work and calls planning's machine.
-- Two reasons, and either alone would settle it: PostgREST exposes `public` and
-- nothing else, so a function anywhere else cannot be called by a client at all;
-- and `070_communication_jobs.sql` asserts that *no* function outside `public` is
-- callable by a client role, which is the invariant that keeps `planning`,
-- `private` and `jobs` reachable only through functions like this one. What
-- stays in `planning` is what only SQL calls: `transition_plan`, `allowed_keys`,
-- `event_for`, `candidate_is_eligible`.
-- ---------------------------------------------------------------------------

create or replace function public.reask_audience(p_plan_id uuid)
returns table (member_user_id uuid, has_responded boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan public.plans;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  if plan.organiser_user_id is distinct from (select auth.uid()) then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  return query
  select pp.user_id,
    exists (
      select 1 from public.plan_responses r
      where r.plan_id = plan.id and r.revision = plan.revision and r.user_id = pp.user_id
    )
  from public.plan_participants pp
  where pp.plan_id = plan.id and pp.revision = plan.revision
  order by pp.user_id;
end;
$$;

comment on function public.reask_audience(uuid) is
  'The participants of a plan''s current revision and whether each has answered — the inputs invalidatedResponses() needs to say who an edit would ask again (spec §5.3). Organiser only.';

revoke all on function public.reask_audience(uuid) from public;
revoke all on function public.reask_audience(uuid) from anon, authenticated;
grant execute on function public.reask_audience(uuid) to authenticated;
