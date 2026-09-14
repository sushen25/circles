-- ---------------------------------------------------------------------------
-- Editing a plan, and unpicking a confirmed one.
--
-- Two lines of work and three reasons to exist. `planning.transition_plan` is in
-- `planning`, which PostgREST does not expose and which
-- `070_communication_jobs.sql` asserts no client may call. The actor has to be
-- `auth.uid()` rather than an argument — `transition_plan` takes one, because
-- SQL callers know who they are acting for, and a client-callable function that
-- did the same would let a caller name somebody else (the lesson S1-13 paid for
-- twice). And the action is fixed to the three this endpoint is for, each
-- derived from what is actually being changed: a wrapper that passed an action
-- through would let a client `confirm` or `expire` a plan without meeting the
-- checks those have endpoints for.
--
-- Everything else is `transition_plan`'s: the organiser guard, the revision
-- bump, `planning.plan_revised` or `confirmation.meetup_rescheduled`, and —
-- through `supersede_on_leaving_confirmed` — the confirmation a reopen has to
-- take with it.
-- ---------------------------------------------------------------------------

create or replace function public.revise_plan(
  p_plan_id uuid,
  p_reopen boolean default false,
  p_payload jsonb default '{}'::jsonb,
  -- Null means "leave them alone". An empty array means nobody is required,
  -- which is a different answer and is kept as one — the same distinction
  -- `create_plan` draws.
  p_required_member_ids uuid[] default null,
  -- What the preview said the plan was. Null means the caller did not preview.
  p_expected_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  revised public.plans;
  audience jsonb;
  action text;
  key text;
  effective_deadline timestamptz;
  wanted uuid[];
begin
  if caller is null then
    raise exception 'revise_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- The lock, and then the audience, and then the change — all three in this
  -- transaction, which is the whole point of doing it here.
  --
  -- The handler used to ask `reask_audience` over HTTP and then call this, and
  -- an answer submitted between the two calls was cleared by the revision bump
  -- while being reported to the organiser as somebody who had *not* answered.
  -- The warning was then wrong about the one person it was most about.
  -- `replace_response` takes this same row lock, so holding it here means a
  -- concurrent answer either lands before we read the audience or waits and
  -- then finds its revision stale.
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Under the lock, before anything is read or written: the warning the
  -- organiser agreed to was about a particular version of this plan, and an
  -- answer arriving since has moved it. §5.3 promises the cost is shown
  -- *before* saving, and a save that costs more than the preview said breaks
  -- that promise however accurately it reports itself afterwards. The same
  -- argument `replace_response` makes about answering a question that has
  -- changed, one level up.
  if p_expected_version is not null
    and p_expected_version is distinct from (plan.revision || '.' || plan.input_version)
  then
    raise exception 'preview_is_stale' using errcode = 'P0001';
  end if;

  -- Through `reask_audience` rather than a second copy of its query: the
  -- preview and the save have to answer the same question the same way, and
  -- two queries that agree today are two queries that can stop agreeing. Its
  -- organiser check runs first as a result, which is the same refusal
  -- `transition_plan`'s guard would raise a moment later.
  select coalesce(jsonb_agg(to_jsonb(a) order by a.member_user_id), '[]'::jsonb)
  into audience
  from public.reask_audience(p_plan_id) a;

  -- Who may be required: the people this revision was addressed to, not every
  -- active member. `replace_response` refuses a non-participant, so requiring
  -- somebody who joined the circle after the plan was created — and who spec §9
  -- deliberately did not add to it — made the plan permanently ineligible with
  -- no way for that person to fix it. Checked before the transition, and an
  -- error rather than a silent drop: an organiser who names five people and
  -- gets four required has been told nothing.
  if p_required_member_ids is not null and exists (
    select 1 from unnest(p_required_member_ids) as required
    where not exists (
      select 1 from public.plan_participants pp
      where pp.plan_id = plan.id and pp.revision = plan.revision and pp.user_id = required
    )
  ) then
    raise exception 'not_a_participant' using errcode = 'P0001';
  end if;

  -- Sent is not changed, decided here rather than only in the Edge Function.
  -- This function is `grant execute … to authenticated`, so "the handler
  -- compares the values first" is a rule the authoritative layer does not hold
  -- (AGENTS.md §6.4) and a client going straight to PostgREST does not obey: a
  -- form resubmitted unedited emitted `planning.plan_revised` to the whole
  -- circle, and a quorum that had not moved threw away a candidate set and
  -- dropped a `ready` plan to `collecting`. A json null is the same no-op
  -- wearing a value: `coalesce` in the update leaves the column alone while the
  -- key makes the payload look like a change.
  p_payload := coalesce(p_payload, '{}'::jsonb);
  foreach key in array array['window_start', 'window_end', 'daily_start_local',
    'daily_end_local', 'duration_minutes', 'quorum', 'response_deadline']
  loop
    if p_payload ? key and (
      jsonb_typeof(p_payload -> key) = 'null'
      or (key = 'window_start' and (p_payload ->> key)::date = plan.window_start)
      or (key = 'window_end' and (p_payload ->> key)::date = plan.window_end)
      or (key = 'daily_start_local' and (p_payload ->> key)::integer = plan.daily_start_local)
      or (key = 'daily_end_local' and (p_payload ->> key)::integer = plan.daily_end_local)
      or (key = 'duration_minutes' and (p_payload ->> key)::integer = plan.duration_minutes)
      or (key = 'quorum' and (p_payload ->> key)::integer = plan.quorum)
      or (key = 'response_deadline'
          and (p_payload ->> key)::timestamptz = plan.response_deadline)
    ) then
      p_payload := p_payload - key;
    end if;
  end loop;

  -- The same question of the required list, and the same answer: a list that
  -- matches the one the plan has is not a change, and rewriting the identical
  -- rows would stale the candidate set for nothing.
  if p_required_member_ids is not null then
    select coalesce(array_agg(distinct u order by u), array[]::uuid[]) into wanted
    from unnest(p_required_member_ids) as u;
    if wanted = (
      select coalesce(array_agg(rm.user_id order by rm.user_id), array[]::uuid[])
      from public.plan_required_members rm
      where rm.plan_id = plan.id and rm.revision = plan.revision
    ) then
      p_required_member_ids := null;
    else
      p_required_member_ids := wanted;
    end if;
  end if;

  if p_payload = '{}'::jsonb and p_required_member_ids is null and not p_reopen then
    raise exception 'nothing_to_change' using errcode = 'P0001';
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
  action := case
    when p_reopen then 'reopen'
    when p_payload ?| array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local', 'duration_minutes'
    ] then 'edit'
    else 'adjust'
  end;

  -- The end of the deadline rule the table cannot check. `plans_deadline` bounds
  -- it above — never after the last possible start — and "not already past" is
  -- not a constraint a table can hold, because it is about now.
  --
  -- Judged on the deadline the plan would be left with, and only for the actions
  -- that ask everybody again: a new revision clears the answers and
  -- `replace_response` refuses a reply once the deadline has gone, so a reopen
  -- into a passed deadline produced a plan that announced a fresh ask nobody was
  -- allowed to answer. An `adjust` leaves the answers where they are, and §5.7's
  -- "give it one more day" is for exactly the plan whose deadline has passed.
  effective_deadline := coalesce(
    (p_payload ->> 'response_deadline')::timestamptz, plan.response_deadline);
  if (action in ('edit', 'reopen') or p_payload ? 'response_deadline')
    and effective_deadline <= now()
  then
    raise exception 'deadline_out_of_range' using errcode = 'P0001';
  end if;

  revised := planning.transition_plan(p_plan_id, action, caller, p_payload);

  -- Who has to be there, if the organiser said. Spec §9's answer to "a required
  -- person leaves" is that "the plan becomes ineligible until the organiser
  -- changes required members or cancels" — so there had to be a way to change
  -- them, and there was none.
  --
  -- Not a revision: it does not change what anybody was asked, so nobody answers
  -- again. It *does* change which times are eligible, so the candidate set has to
  -- be recomputed for the same reason a quorum change does — and after the
  -- transition, so that the rows land on the revision the plan is on now.
  if p_required_member_ids is not null then
    delete from public.plan_required_members rm
    where rm.plan_id = revised.id and rm.revision = revised.revision;

    insert into public.plan_required_members (plan_id, revision, user_id)
    select distinct revised.id, revised.revision, required
    from unnest(p_required_member_ids) as required;

    update public.plans p
    set input_version = p.input_version + 1
    where p.id = revised.id
    returning * into revised;
  end if;

  -- A stale set is not a set. Bumping `input_version` says "recompute" to the
  -- engine, and says nothing at all to a plan sitting in `ready`:
  -- `candidate_is_eligible` checks the versions, so `confirm` would refuse the
  -- displayed candidates while every state-driven screen still read "ready" —
  -- the same trap `replace_response` avoids by firing `candidates_gone` when an
  -- answer moves. Quorum and required members both change which times qualify,
  -- so both do it here; a deadline-only adjustment changes neither and leaves a
  -- ready plan ready (ADR 0017). `candidates_gone` has no guards and no event:
  -- nobody is told the set is being recomputed, because nobody was told it
  -- existed.
  if revised.state = 'ready' and (p_payload ? 'quorum' or p_required_member_ids is not null) then
    revised := planning.transition_plan(revised.id, 'candidates_gone', caller);
  end if;

  -- The plan *and* the audience it had when this transaction began. Two values,
  -- so one object: the handler needs the new revision to report and the old
  -- audience to warn about, and computing the second anywhere else reintroduces
  -- the gap this function was given the lock to close.
  return jsonb_build_object(
    'plan', to_jsonb(revised),
    'audience', audience,
    -- The version the audience was read at, which is the version this answer
    -- describes — not the one the change has just produced.
    'version', plan.revision || '.' || plan.input_version
  );
end;
$$;

comment on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) is
  'Edits a plan, or reopens a confirmed one, as the calling organiser. Returns the revised plan and the audience it had before the change, derived under the same lock. A fixed set of actions over planning.transition_plan, which no client can call.';

revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) from public;
revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) from anon, authenticated;
grant execute on function public.revise_plan(uuid, boolean, jsonb, uuid[], text) to authenticated;
