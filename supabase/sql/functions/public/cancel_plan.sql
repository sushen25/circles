-- ---------------------------------------------------------------------------
-- Calling it off.
--
-- The wrapper exists for the reasons `revise_plan`'s does: `planning` is not
-- exposed, and the actor must be `auth.uid()` rather than something a caller
-- says. Which event goes out is not this function's decision either —
-- `planning.event_for` sends `confirmation.meetup_cancelled` when the plan was
-- confirmed and `planning.plan_cancelled` when it was only being asked about,
-- because "Thursday is off" reaches people who put it in a calendar and
-- withdrawing an ask does not.
--
-- The note is the organiser's own words. It is stored on the plan for the
-- notification pipeline to read and never travels in the event: an outbox
-- payload is checked by `jobs.carries_content`, which refuses free text at any
-- depth (non-negotiable 8).
-- ---------------------------------------------------------------------------

create or replace function public.cancel_plan(
  p_plan_id uuid,
  p_note text default null
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
    raise exception 'cancel_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'cancel_plan_sql', extensions.digest(caller::text, 'sha256'), 60, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;
  if not public.take_rate_token(
    'cancel_plan_sql_plan', extensions.digest(caller::text || ':' || p_plan_id::text, 'sha256'), 20, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  return planning.transition_plan(
    p_plan_id,
    'cancel',
    caller,
    case
      when p_note is null or btrim(p_note) = '' then '{}'::jsonb
      else jsonb_build_object('cancel_note', p_note)
    end
  );
end;
$$;

comment on function public.cancel_plan(uuid, text) is
  'Cancels a plan as the calling organiser, with an optional note the notices carry. Which cancellation event goes out is planning.event_for''s, from the state it was in.';

revoke all on function public.cancel_plan(uuid, text) from public;
revoke all on function public.cancel_plan(uuid, text) from anon, authenticated;
grant execute on function public.cancel_plan(uuid, text) to authenticated;
