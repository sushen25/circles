-- ---------------------------------------------------------------------------
-- "See if people are keen" (spec §5.4): a quiet ask comes into existence in
-- `draft` and is moved to `seeking` by the machine, as `create_plan` moves a
-- named plan to `collecting`.
--
-- Everything that is a calculation arrives resolved from `packages/domain`:
-- the window (`resolvePreset`) and the stop time (`resolveStopTime`, from the
-- option the person picked — never an instant from the client). What is
-- decided here is what only the database can see under the circle's lock:
--
--   * **The threshold**, `quietThreshold(n)` = `min(n, max(3, ceil(n / 4)))`
--     for the circle's active members at this moment, stored and never
--     recomputed (ADR 0035).
--   * **Whether this member may ask**, `canCreateQuietAsk` in the same order:
--     a saved place, an active member, a live circle, quiet asks not muted,
--     somebody to ask, no plan already finding a time (the machine's
--     `no_open_plan` guard, not a second copy of it — SUS-89), not already
--     asking here, and fewer than three asks in the circle in seven days. The
--     last two are checked *after* the transition, so that the refusals come
--     in the domain's order; raising there rolls the draft and its event back
--     with it, as a refused guard does.
--
-- **The two secrets are written here and nowhere else.** `private.plan_initiators`
-- records who asked, and the initiator's own `keen` answer goes into
-- `private.plan_interest` — the domain counts them as an ordinary keen answer,
-- and the `threshold` guard counts `plan_interest` rows and nothing else, so
-- the initiator is counted once and through that row (SUS-49 note 3).
--
-- What the public row does **not** get: an organiser (none until somebody
-- accepts, §8.2 — `plans_quiet_has_no_organiser`), a required member (the
-- organiser is required by default on a named plan; on a quiet one the only
-- candidate is the initiator, and `plan_required_members` is readable by the
-- whole circle), and anything else that could say who. The participants are
-- the whole circle, the initiator among them, which says nothing.
--
-- The response deadline of a seeking ask is its stop time. It is replaced when
-- the ask opens (`threshold_reached` carries the domain's deadline for that
-- moment), and nothing reads it before then: the deadline sweeps look only at
-- `collecting` and `ready`.
--
-- **Service role only**, with the actor passed in by `create-plan` from the
-- verified JWT (review round 1). The window, the preset and the stop time are
-- the domain's resolution of what the person picked, and a function a client
-- could call directly would take any window labelled `tonight` and any stop
-- instant the table's broad constraints allow. `create_plan` is the client's
-- own for a named plan because every number it takes is one an organiser may
-- choose; nothing here is.
--
-- `already_asking` is a refusal about the caller's own ask and is theirs to
-- hear. The function logs nothing and the endpoint logs the reason without the
-- caller, which is what keeps "refused for already asking" from becoming the
-- initiator's identity in a log (SUS-49 note 12).
-- ---------------------------------------------------------------------------

create or replace function public.create_quiet_ask(
  p_actor uuid,
  p_circle_id uuid,
  p_title text,
  p_category text,
  p_window_start date,
  p_window_end date,
  p_daily_start_local integer,
  p_daily_end_local integer,
  p_duration_minutes integer,
  p_preset text,
  p_quiet_expires_at timestamptz
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  caller uuid := p_actor;
  circle public.circles;
  member public.circle_members;
  active_members integer;
  created public.plans;
  code text;
  i integer;
begin
  if caller is null then
    raise exception 'create_quiet_ask requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into circle from public.circles c where c.id = p_circle_id for update;
  if not found then
    raise exception 'circle_not_found' using errcode = 'no_data_found';
  end if;

  -- `canCreateQuietAsk`'s order, from here to the transition.
  if not coalesce((select pr.is_permanent from public.profiles pr where pr.user_id = caller), false) then
    raise exception 'requires_saved_place' using errcode = 'P0001';
  end if;

  select * into member from public.circle_members m
  where m.circle_id = p_circle_id and m.user_id = caller and m.status = 'active';
  if not found then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  if circle.status <> 'active' then
    raise exception 'circle_archived' using errcode = 'check_violation';
  end if;

  -- Before anything that depends on other people's asks: a member who has
  -- muted them, and so received none, is not told by a refusal that some exist.
  if member.muted_quiet_asks then
    raise exception 'quiet_asks_muted' using errcode = 'P0001';
  end if;

  select count(*)::integer into active_members
  from public.circle_members m
  where m.circle_id = p_circle_id and m.status = 'active';
  if active_members < 2 then
    raise exception 'nobody_to_ask' using errcode = 'P0001';
  end if;

  -- The stop time passed between the domain resolving it and this line.
  -- `enforce_plan_deadline` holds the other end, the last possible start.
  if p_quiet_expires_at is null or p_quiet_expires_at <= now() then
    raise exception 'stop_time_unavailable' using errcode = 'P0001';
  end if;

  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(
        alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)),
        1
      );
    end loop;
    exit when not exists (select 1 from public.plans p where p.short_code = code);
  end loop;

  insert into public.plans (
    circle_id, mode, organiser_user_id, title, category, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, quorum_source, response_deadline, short_code,
    quiet_threshold, quiet_expires_at, quiet_preset
  )
  values (
    p_circle_id, 'quiet', null, p_title, p_category, circle.time_zone,
    p_window_start, p_window_end, p_daily_start_local, p_daily_end_local,
    p_duration_minutes,
    -- The quorum `create_plan` would give a plan nobody chose one for
    -- (ADR 0026): the circle's default, else the rule over this audience.
    coalesce(circle.default_quorum, public.soft_quorum(active_members)),
    case when circle.default_quorum is null then 'defaulted' else 'chosen' end,
    p_quiet_expires_at, code,
    -- `quietThreshold(n)`, mirrored: three up to twelve, a quarter above that,
    -- never more than the circle (ADR 0035).
    least(active_members, greatest(3, ceil(active_members / 4.0)::integer)),
    p_quiet_expires_at, p_preset
  )
  returning * into created;

  insert into public.plan_participants (plan_id, revision, user_id)
  select created.id, created.revision, m.user_id
  from public.circle_members m
  where m.circle_id = p_circle_id and m.status = 'active';

  insert into private.plan_initiators (plan_id, initiator_user_id)
  values (created.id, caller);

  insert into private.plan_interest (plan_id, user_id, response)
  values (created.id, caller, 'keen');

  -- `member`, `permanent` and `no_open_plan` (`plan_in_progress`, ADR 0033).
  -- The circle is already locked, so the guard's own lock is this one.
  created := planning.transition_plan(created.id, 'create_quiet', caller);

  -- One open ask per member per circle (spec §5.4). Any age: an older ask
  -- still seeking is still open.
  if exists (
    select 1 from public.plans p
    join private.plan_initiators pi on pi.plan_id = p.id
    where p.circle_id = p_circle_id and p.id <> created.id
      and p.mode = 'quiet' and p.state = 'seeking'
      and pi.initiator_user_id = caller
  ) then
    raise exception 'already_asking' using errcode = 'P0001';
  end if;

  -- Three per circle in any seven days, in every state: a withdrawn or expired
  -- ask still prompted everyone. Not scaled to the circle (ADR 0035).
  if (
    select count(*) from public.plans p
    where p.circle_id = p_circle_id and p.id <> created.id
      and p.mode = 'quiet' and p.state <> 'draft'
      and p.created_at > now() - interval '7 days'
  ) >= 3 then
    raise exception 'circle_ask_limit' using errcode = 'P0001';
  end if;

  return created;
end;
$$;

comment on function public.create_quiet_ask(uuid, uuid, text, text, date, date, integer, integer, integer, text, timestamptz) is
  'Creates a quiet ask as the given member (service role only, actor from the verified JWT): a draft addressed to the whole circle, the initiator and their keen answer recorded privately, moved to seeking through the state machine. Threshold and limits are decided under the circle''s lock (S2-02, ADR 0035).';

revoke all on function public.create_quiet_ask(uuid, uuid, text, text, date, date, integer, integer, integer, text, timestamptz) from public;
revoke all on function public.create_quiet_ask(uuid, uuid, text, text, date, date, integer, integer, integer, text, timestamptz) from anon, authenticated;
grant execute on function public.create_quiet_ask(uuid, uuid, text, text, date, date, integer, integer, integer, text, timestamptz) to service_role;
