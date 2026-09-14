-- Parameters carry a `p_` prefix, as `transition_plan`'s do: a parameter named
-- `plan_id` is ambiguous against the column of the same name inside
-- `on conflict (plan_id, …)`, and plpgsql refuses to guess.

create or replace function public.replace_response(
  p_plan_id uuid,
  -- The revision the client is answering. Required, because an answer is an
  -- answer to a *question*, and the question can change while a draft sits on
  -- a phone with no signal (spec §5.5). Storing revision 1's windows under
  -- revision 2 would be silently answering dates the person never saw.
  p_revision integer,
  p_status text,
  p_windows jsonb default '[]'::jsonb,
  p_used_calendar_overlay boolean default false
)
returns public.plan_responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  response public.plan_responses;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- The lock: two submissions from one person's two devices would otherwise
  -- interleave their window deletes and inserts.
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not public.auth_is_member(plan.circle_id) then
    -- The same answer for "no such plan" and "not your circle": telling them
    -- apart would confirm a plan id exists.
    raise exception 'plan_not_found' using errcode = 'insufficient_privilege';
  end if;

  -- The question moved on. Refused with its own code so the client can fetch
  -- the plan again and re-ask, rather than being told its window was malformed.
  --
  -- The two revisions go in `detail`, not in the message: `_shared/problem.ts`
  -- turns an exception's text into a `ProblemReason` by exact match, so a
  -- message with numbers in it is a refusal no endpoint can translate — the
  -- client got 500 for the one refusal it knows how to recover from. The
  -- numbers are still in the database log, where whoever is debugging is.
  if p_revision <> plan.revision then
    raise exception 'stale_revision'
      using errcode = 'serialization_failure',
            detail = format('answered %s but the plan is at %s', p_revision, plan.revision);
  end if;

  -- Addressed to this person: spec §9 makes joining an active plan an opt-in,
  -- and answering a question you were not asked is how a newcomer becomes a
  -- non-responder to it.
  if not exists (
    select 1 from public.plan_participants pp
    where pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = caller
  ) then
    raise exception 'not_a_participant' using errcode = 'insufficient_privilege';
  end if;

  -- "Editing is allowed until confirmation or the deadline" (spec §5.5). One
  -- name for both, because they are one answer to the person: replies are
  -- closed. Which of the two it was goes in `detail`.
  if plan.state not in ('collecting', 'ready') then
    raise exception 'replies_closed' using errcode = 'check_violation',
      detail = format('the plan is %s', plan.state);
  end if;
  if now() >= plan.response_deadline then
    raise exception 'replies_closed' using errcode = 'check_violation',
      detail = format('the deadline passed at %s', plan.response_deadline);
  end if;

  -- A SQL null is not an empty list: `jsonb_array_length(null)` is null, and
  -- `null = 0` is not true, so a null slipped past this check and produced a
  -- `windows` answer with no windows. Coalesce first, and insist on an array.
  p_windows := coalesce(p_windows, '[]'::jsonb);
  if jsonb_typeof(p_windows) <> 'array' then
    raise exception 'windows_do_not_match_status' using errcode = 'check_violation',
      detail = 'windows must be a list';
  end if;

  -- The domain's union, enforced: only a `windows` answer carries windows, and
  -- a `windows` answer carries at least one. One name, because it is one
  -- mistake from either side — and a name rather than a sentence, so that a
  -- caller who reaches this function directly gets the same 400 the request
  -- schema would have given.
  if (p_status = 'windows') <> (jsonb_array_length(p_windows) > 0) then
    raise exception 'windows_do_not_match_status' using errcode = 'check_violation',
      detail = format('a %s answer carries %s windows', p_status, jsonb_array_length(p_windows));
  end if;

  -- One bump for the whole answer, at the end; the row triggers stand down
  -- for the length of this function.
  perform set_config('circles.in_replace_response', 'on', true);

  -- Replace, not merge. The person's answer is the whole list they sent.
  delete from public.willing_windows ww
  using public.plan_responses r
  where ww.response_id = r.id
    and r.plan_id = plan.id and r.revision = plan.revision and r.user_id = caller;

  insert into public.plan_responses (plan_id, revision, user_id, status, used_calendar_overlay, submitted_at)
  values (plan.id, plan.revision, caller, p_status, p_used_calendar_overlay, now())
  on conflict (plan_id, revision, user_id) do update
    set status = excluded.status,
        used_calendar_overlay = excluded.used_calendar_overlay,
        submitted_at = excluded.submitted_at
  returning * into response;

  insert into public.willing_windows (response_id, starts_at, ends_at)
  select response.id, (w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz
  from jsonb_array_elements(p_windows) as w;

  perform set_config('circles.in_replace_response', 'off', true);
  update public.plans p set input_version = p.input_version + 1 where p.id = plan.id;

  -- Architecture §8.3: `ready ─(response change)─▶ collecting`. A ready plan
  -- whose answers just moved has no current candidate set — `confirm` would
  -- refuse the old one as stale while every state-driven screen and job still
  -- saw "ready". `candidates_gone` is the engine's verdict and carries no
  -- actor guard, so the person who answered can be the one to fire it; the
  -- recalculation brings it back to ready.
  if plan.state = 'ready' then
    perform planning.transition_plan(plan.id, 'candidates_gone', caller);
  end if;

  -- `availability.response_submitted` is written to `jobs.outbox` by the row
  -- trigger on `plan_responses` (0006), in this transaction: one event per
  -- answer, because the upsert above touches the row exactly once.

  return response;
end;
$$;

comment on function public.replace_response(uuid, integer, text, jsonb, boolean) is
  'Replaces the caller''s answer to the given plan revision atomically; refuses a revision the plan has moved past. The only write path for responses and windows (ADR 0013).';

revoke all on function public.replace_response(uuid, integer, text, jsonb, boolean) from public;
revoke all on function public.replace_response(uuid, integer, text, jsonb, boolean) from anon, authenticated;
grant execute on function public.replace_response(uuid, integer, text, jsonb, boolean) to authenticated;
