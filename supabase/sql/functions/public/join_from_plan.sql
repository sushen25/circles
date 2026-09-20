-- ---------------------------------------------------------------------------
-- join_from_plan
--
-- Joining a circle from the link the group chat actually sees (ADR 0022).
--
-- The message an organiser pastes carries only the plan's link, `/j/<code>`.
-- Until ADR 0022 that link was a dead end for anybody new: the circle's invite
-- secret was the only thing that could create a membership, and a plan link
-- does not carry it. Now **the plan's short code admits, while the plan is
-- taking answers**, and joining through it makes the person one of the people
-- that plan is asking.
--
-- **What authorises it is the code and the plan's state, together.** Only a
-- plan in `collecting` or `ready` whose response deadline is still ahead, in an
-- active circle — the domain's `acceptsAnswers`, and the same two conditions
-- `replace_response` checks. A quiet ask still `seeking`, a confirmed plan, a
-- finished, expired or cancelled one, and a code that does not exist all get
-- one answer, `invite_inactive`. That is the whole of the promise: **a refusal
-- does not say why.** It does not hide that a plan is taking answers — a join
-- that succeeds says so — and `preview_for_code` already names the circle
-- behind any code; what it must not add is a way to tell a quiet ask from a
-- cancelled plan by how the door is shut.
--
-- The code is weak on purpose (ADR 0022's consequences): eight characters,
-- in URL paths, not revocable, bounded by the deadline. What makes that
-- acceptable is that guessing is slow — Turnstile, and limits per code and per
-- address — and those live in the `join-plan` Edge Function, because only it
-- can see a Turnstile token or the caller's address.
--
-- **So this is the service role's, and the person joining is a parameter.**
-- `redeem_invite` is granted to `authenticated` and acts on `auth.uid()`, and
-- it can be: its secret is 256 bits, so a client calling the RPC directly and
-- skipping the function's limits gains volume and nothing else. Here the same
-- grant was the hole. Any session, an anonymous one included, could call
-- `/rest/v1/rpc/join_from_plan` as often as it liked, and every guess that
-- landed was a seat in somebody's circle. Taking the grant away makes the Edge
-- Function the only way in, which is `claim_identity`'s shape for the same
-- reason: the proof the database cannot check is checked before it is called.
-- The id comes from the caller's verified JWT (`actor.userId`), never from the
-- request body.
--
-- **Already a member.** No name is read. The person is added to the plan's
-- current revision if they are not on it, which is spec §9's "new members may
-- opt into the active plan": somebody who joined through the invite while this
-- plan was running was never asked, and opening its link asks them. No
-- membership is written, so no join is announced.
--
-- **A new member** is admitted by `private.admit_member`, under the circle's
-- lock — the cap, the name and rejoining after removal, exactly as an invite
-- does it — and added to the plan in the same transaction. A guest must give a
-- name. A saved place may leave it out and joins under their profile's name,
-- which names the membership in this circle and nothing else: after a
-- `duplicate_name` they pass one, and their profile is not touched.
--
-- **The quorum moves with the circle, while nobody has chosen it** (ADR 0026).
-- A plan made on the first run is made on a circle of one, seconds old, so its
-- quorum is a placeholder: `public.soft_quorum` of the active members, rewritten
-- on every join that admits somebody new, through `quorum_follows` — no new
-- revision, so every answer already given stands, and no event, because the
-- join itself was announced. A quorum the organiser set (`quorum_source` is
-- `chosen`) never moves here, and neither does one on a plan whose members are
-- leaving: a removal that lowered the quorum would make a plan `ready` as a
-- side effect of somebody leaving.
--
-- **The input version does**, when somebody is added to the plan. The roster is
-- engine input — `engine_input` reads `plan_participants`, and the set it
-- stores says "4 of 7" — so a set computed before the join is a set about a
-- different audience, which is what `on_member_removed` says for the opposite
-- move. The Edge Function recalculates in the same request (ADR 0018). A call
-- that adds nobody bumps nothing: an organiser looking at the set must not have
-- it replaced because somebody already on the plan opened its link again.
--
-- Returns the circle, the plan's id, and whether this call added the caller to
-- the plan — the last so the Edge Function recalculates only when something
-- changed.
-- ---------------------------------------------------------------------------

create or replace function public.join_from_plan(
  -- Who is joining: the verified caller, as `join-plan` resolved them.
  p_user_id uuid,
  p_short_code text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := p_user_id;
  found_plan_id uuid;
  plan public.plans;
  target public.circles;
  chosen_name text := p_display_name;
  added integer;
  members integer;
  following integer;
  quorum_moved boolean := false;
  restaled boolean := false;
begin
  if caller is null then
    raise exception 'join_from_plan requires the person joining'
      using errcode = 'insufficient_privilege';
  end if;

  -- Shape first, as `preview_for_code` does: rubbish never reaches the tables.
  -- The short-code alphabet has no `i`, `l`, `o`, `0` or `1` in it.
  if p_short_code is null or p_short_code !~ '^[a-hjkmnp-z2-9]{6,12}$' then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  select p.id into found_plan_id from public.plans p where p.short_code = p_short_code;
  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- Circle before plan, the order `create_plan` and `on_member_removed` take
  -- the same two locks in; transactions that lock in one order cannot deadlock
  -- over them. The circle's lock serialises joins, which is what the cap and
  -- the name check depend on. The plan's holds it in the state it is judged in
  -- below: a confirm or a cancel committing between the check and the insert
  -- would otherwise add somebody to a plan that was no longer asking.
  select c.* into target
  from public.circles c
  join public.plans p on p.circle_id = c.id
  where p.id = found_plan_id
  for update of c;

  select * into plan from public.plans p where p.id = found_plan_id for update;

  -- One answer for every way a plan is not admitting. The detail stays out of
  -- the message on purpose: `_shared/problem.ts` maps the message, and the
  -- message is what the caller sees.
  if target.status <> 'active'
    or plan.state not in ('collecting', 'ready')
    or now() >= plan.response_deadline
  then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target.id and m.user_id = caller and m.status = 'active'
  ) then
    -- A saved place's profile name, when they gave none. Read from
    -- `auth.users` rather than the JWT claim, which `reattach_member` explains:
    -- a token issued minutes before somebody saved their place still says
    -- `is_anonymous: true`.
    if chosen_name is null and exists (
      select 1 from auth.users u where u.id = caller and not coalesce(u.is_anonymous, true)
    ) then
      select pr.display_name into chosen_name from public.profiles pr where pr.user_id = caller;
    end if;

    if chosen_name is null then
      raise exception 'display_name_unusable' using errcode = 'check_violation';
    end if;

    perform private.admit_member(target.id, caller, chosen_name);
  end if;

  insert into public.plan_participants (plan_id, revision, user_id)
  values (plan.id, plan.revision, caller)
  on conflict do nothing;
  get diagnostics added = row_count;

  if added > 0 then
    update public.plans p
    set input_version = p.input_version + 1
    where p.id = plan.id;

    -- Architecture §8.3's `ready ─(response change)─▶ collecting`, for the same
    -- reason `replace_response` and `revise_plan` fire it: a ready plan whose
    -- input just moved has no current candidate set. `join-plan` recalculates
    -- straight after and tolerates that failing (ADR 0018), and a plan left
    -- `ready` meanwhile is one every screen and job reads as confirmable while
    -- `confirm` refuses its set as stale. The recalculation brings it back.
    -- `candidates_gone` has no guard and announces nothing.
    if plan.state = 'ready' then
      perform planning.transition_plan(plan.id, 'candidates_gone', caller);
      restaled := true;
    end if;
  end if;

  -- A quorum nobody chose, on the audience this join just changed.
  --
  -- Keyed on the *participant* row, not on the membership: a member of the
  -- circle who opens the plan for the first time is somebody the plan is now
  -- asking, and no membership is written for them (review round 3).
  if added > 0 then
    -- The count *after* the admission, and of the people this plan is actually
    -- asking — its participants at this revision — rather than the circle's
    -- roster.
    --
    -- Two things follow, and both are the point (review round 2). A member who
    -- joined by the circle's invite and never opened this plan was never asked
    -- (spec §9 makes joining an active plan an opt-in), so they must not raise
    -- the number of people who have to make it — a quorum above the people who
    -- can answer is a plan that can never reach it. And a circle's *other*
    -- defaulted plans are left alone, because their own audiences did not
    -- change; the rule follows the question, not the address book.
    select count(*) into members
    from public.plan_participants pp
    join public.circle_members m
      on m.circle_id = target.id and m.user_id = pp.user_id and m.status = 'active'
    where pp.plan_id = plan.id and pp.revision = plan.revision;

    following := public.soft_quorum(members);
    if plan.quorum_source = 'defaulted' and following is distinct from plan.quorum then
      -- The plan's own rule writing, under the lock this function already
      -- holds. `transition_plan` bumps the input version for a quorum change
      -- and leaves the revision alone (ADR 0017), so the candidate set is
      -- restaled and the answers are kept.
      perform planning.transition_plan(
        plan.id, 'quorum_follows', caller, jsonb_build_object('quorum', following)
      );
      quorum_moved := true;
    end if;
  end if;

  -- A `ready` plan whose quorum just moved must not stay `ready`: a candidate
  -- set is eligible on its versions and never reads the quorum, so a
  -- four-person option would stay confirmable under a quorum of five. Once is
  -- enough — the roster change above may have said it already.
  if quorum_moved and plan.state = 'ready' and not restaled then
    perform planning.transition_plan(plan.id, 'candidates_gone', caller);
  end if;

  return jsonb_build_object(
    'circle', to_jsonb(target),
    'plan_id', plan.id,
    'newly_asked', added > 0
  );
end;
$$;

comment on function public.join_from_plan(uuid, text, text) is
  'Joins a person to the circle behind a plan short code while that plan is taking answers, and adds them to its current revision (ADR 0022). Idempotent; moves a quorum nobody chose to soft_quorum of the new member count (ADR 0026). Raises invite_inactive for every plan that is not admitting, or duplicate_name, display_name_unusable, circle_full. Service role only: Turnstile and the rate limits that make a short code acceptable are in the join-plan Edge Function, and a client calling this directly would skip them.';

revoke all on function public.join_from_plan(uuid, text, text) from public;
revoke all on function public.join_from_plan(uuid, text, text) from anon, authenticated;
grant execute on function public.join_from_plan(uuid, text, text) to service_role;
