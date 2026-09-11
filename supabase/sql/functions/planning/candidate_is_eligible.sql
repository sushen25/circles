-- ---------------------------------------------------------------------------
-- The candidate guard: whether an id names a time still on offer.
--
-- The check is the domain's: the id names an eligible candidate in the set for
-- the plan's *current* revision, input version and scoring version — a
-- candidate can stop being eligible between the organiser opening the review
-- screen and tapping the button, and a set computed before somebody withdrew
-- a reply names people who are no longer free.
-- ---------------------------------------------------------------------------

create or replace function planning.candidate_is_eligible(plan public.plans, candidate_id text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  start_at timestamptz;
begin
  -- The client's candidate id is the ISO start (candidateIdOf). Anything that
  -- is not an instant is not a candidate, rather than an error.
  begin
    start_at := candidate_id::timestamptz;
  exception when others then
    return false;
  end;

  return exists (
    select 1
    from public.candidate_sets cs
    join public.candidates c on c.candidate_set_id = cs.id
    where cs.plan_id = plan.id
      and cs.revision = plan.revision
      and cs.input_version = plan.input_version
      and cs.scoring_version = plan.scoring_version
      and not c.is_near_miss
      and c.starts_at = start_at
  );
end;
$$;

revoke all on function planning.candidate_is_eligible(public.plans, text) from public;
revoke all on function planning.candidate_is_eligible(public.plans, text) from anon, authenticated;
