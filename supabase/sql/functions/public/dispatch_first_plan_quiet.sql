-- ---------------------------------------------------------------------------
-- The founder's "want a hand?" letter, decided: the record that this circle
-- has been sent it, and the job that carries it, in one transaction
-- (SUS-240, ADR 0085).
--
-- **Once per circle, ever.** The idempotency key cannot say that on its own:
-- it is per recipient, plan and revision, so a second stalled plan in the same
-- circle would have a key of its own. And the jobs table is cleaned after
-- thirty days. So the cap is its own row, `private.first_plan_quiet_letters`,
-- keyed on the circle, and a job is written only by the call that wrote that
-- row. The row is written even when there is no job (`p_jobs` empty: the
-- organiser has organiser letters off, or no address we may write to), so a
-- letter that was not wanted at 48 hours is not sent at 60 because a switch
-- changed: it was decided once.
--
-- **The facts are asked again under the lock.** The circle row is locked first
-- (the lock `planning.transition_plan` takes), then the plan must still be its
-- circle's first named plan, still asking, with no answer from anyone but its
-- organiser. Anything else writes nothing and answers null, so the caller
-- records nothing: somebody answered between the sweep's read and this call.
--
-- Answers how many jobs were written, or null when nothing was decided.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_first_plan_quiet(p_plan_id uuid, p_jobs jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_circle uuid;
  v_organiser uuid;
  decided integer;
begin
  -- Every job is this plan's first_plan_quiet: refused rather than quietly
  -- written, whatever else holds.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j
    where (j ->> 'plan_id')::uuid is distinct from p_plan_id
       or j ->> 'kind' is distinct from 'first_plan_quiet'
  ) then
    raise exception 'dispatch_first_plan_quiet: jobs must be this plan''s first_plan_quiet'
      using errcode = 'check_violation';
  end if;

  select p.circle_id into v_circle from public.plans p where p.id = p_plan_id;
  if v_circle is null then
    return null;
  end if;

  perform 1 from public.circles c where c.id = v_circle for update;

  select p.organiser_user_id into v_organiser
  from public.plans p
  where p.id = p_plan_id
    and p.mode = 'named'
    and p.state in ('collecting', 'ready')
    and p.id = (
      select f.id from public.plans f
      where f.circle_id = p.circle_id and f.mode = 'named'
      order by f.created_at, f.id
      limit 1
    );
  if v_organiser is null then
    return null;
  end if;

  if exists (
    select 1 from public.plan_responses r
    where r.plan_id = p_plan_id and r.user_id is distinct from v_organiser
  ) then
    return null;
  end if;

  insert into private.first_plan_quiet_letters (circle_id, plan_id)
  values (v_circle, p_plan_id)
  on conflict (circle_id) do nothing;
  get diagnostics decided = row_count;
  if decided = 0 then
    return null;
  end if;

  return public.dispatch_enqueue(p_jobs);
end;
$$;

comment on function public.dispatch_first_plan_quiet(uuid, jsonb) is
  'Records that a circle has been sent the founder''s first_plan_quiet letter (or decided not to), once per circle ever, and writes the job that carries it, under the circle lock; null when the plan is no longer the circle''s first asking plan, someone else has answered it, or the circle was decided already. Service role only (SUS-240, ADR 0085).';

revoke all on function public.dispatch_first_plan_quiet(uuid, jsonb) from public;
revoke all on function public.dispatch_first_plan_quiet(uuid, jsonb) from anon, authenticated;
grant execute on function public.dispatch_first_plan_quiet(uuid, jsonb) to service_role;
