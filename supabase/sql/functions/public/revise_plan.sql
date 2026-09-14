-- ---------------------------------------------------------------------------
-- Editing a plan, and unpicking a confirmed one.
--
-- Two lines of work and three reasons to exist. `planning.transition_plan` is in
-- `planning`, which PostgREST does not expose and which
-- `070_communication_jobs.sql` asserts no client may call. The actor has to be
-- `auth.uid()` rather than an argument — `transition_plan` takes one, because
-- SQL callers know who they are acting for, and a client-callable function that
-- did the same would let a caller name somebody else (the lesson S1-13 paid for
-- twice). And the action is fixed to the two this endpoint is for: a wrapper
-- that passed an action through would let a client `confirm` or `expire` a plan
-- without meeting the checks those have endpoints for.
--
-- Everything else is `transition_plan`'s: the organiser guard, the revision
-- bump, `planning.plan_revised` or `confirmation.meetup_rescheduled`, and —
-- through `supersede_on_leaving_confirmed` — the confirmation a reopen has to
-- take with it.
-- ---------------------------------------------------------------------------

create or replace function public.revise_plan(
  p_plan_id uuid,
  p_reopen boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'revise_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- Which action this is, from what is being changed rather than from what the
  -- caller says it is. A payload touching the window, the band or the duration
  -- changes *the question* and earns a new revision; one touching only the
  -- quorum or the deadline changes what happens to the answers and must not
  -- (spec §5.3).
  --
  -- Derived here, not passed in, so a client cannot ask for the cheap action and
  -- the expensive change. It could not get far if it tried —
  -- `planning.allowed_keys('adjust')` is those two keys alone — but the caller
  -- having no say is simpler than the caller being caught.
  return planning.transition_plan(
    p_plan_id,
    case
      when p_reopen then 'reopen'
      when coalesce(p_payload, '{}'::jsonb) ?| array[
        'window_start', 'window_end', 'daily_start_local', 'daily_end_local', 'duration_minutes'
      ] then 'edit'
      else 'adjust'
    end,
    caller,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

comment on function public.revise_plan(uuid, boolean, jsonb) is
  'Edits a plan, or reopens a confirmed one, as the calling organiser. A fixed pair of actions over planning.transition_plan, which no client can call.';

revoke all on function public.revise_plan(uuid, boolean, jsonb) from public;
revoke all on function public.revise_plan(uuid, boolean, jsonb) from anon, authenticated;
grant execute on function public.revise_plan(uuid, boolean, jsonb) to authenticated;
