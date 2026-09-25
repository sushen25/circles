-- ---------------------------------------------------------------------------
-- 0026 — The quiet ask's backend (SUS-50, S2-02).
--
-- S1-08 built the quiet ask's storage — `private.plan_initiators`,
-- `private.plan_interest`, `plan_interest_counts`, the `seeking` rows of the
-- transition table — and S2-01 its rules in `packages/domain` (ADR 0035).
-- This is the part in between: the functions that create one, record an
-- answer, open it at its threshold exactly once, let somebody take the
-- organiser role, and close it at its stop time.
--
-- **Shape.**
--
--   * `plans.quiet_preset` — the window a quiet ask was made with. The
--     deadline an ask gets when it opens is `defaultDeadline(preset, now, …)`,
--     which needs it, and `plans` had nowhere to keep it (SUS-49 note 8). Not
--     a secret: the window is on the row already, and the preset only names it.
--   * `plans_quiet_expires` — a quiet ask has a stop time from the moment it is
--     asking. Its other end, strictly before the last possible start, is in
--     `enforce_plan_deadline` (stable, not immutable), which is why the
--     trigger now also fires on `quiet_expires_at` and `state`.
--   * `plans_quiet_has_no_organiser` — nobody organises a quiet ask until it
--     has opened and somebody has accepted (§8.2). True of every row the
--     functions write already; now true of every row.
--   * `notification_jobs_kind` — `quiet_expired`, the initiator's "not enough
--     people were free this time" (ADR 0038).
--
-- Each constraint is a `case`, never an `or` of conjunctions: a null CHECK
-- result passes in Postgres, and that is how a quiet plan with no threshold was
-- once storable (SUS-24).
--
-- **Rows written before this.** No endpoint could create a quiet ask until now
-- (`create-plan` answered `not_yet`), so the only quiet plans are the seed's
-- and the tests'. They are given the preset their window most resembles and,
-- if they have no stop time, their response deadline as one (a minute before
-- the last possible start at the latest, since the stop time must be strictly
-- before it) — so the new
-- constraints hold and nothing is expired by a migration.
--
-- **Functions** (the generated block below; each file under
-- `supabase/sql/functions/` says what it is): `create_quiet_ask`,
-- `record_interest`, `accept_organiser`, `quiet_viewer_facts`, `planning.open_quiet_ask`,
-- `dispatch_open_quiet_ask`, `dispatch_quiet_audience`, and changes to
-- `allowed_keys` (`threshold_reached` takes the deadline), `on_member_removed`
-- (a removed member's answer to an ask still asking goes with them),
-- `enforce_plan_deadline` (the stop time) and `dispatch_timed_work` (the
-- expiry sweep and the held asks).
--
-- The transition table is reseeded unchanged. `MIGRATION` in both
-- `scripts/gen-transitions.mjs` and `scripts/gen-sql-functions.mjs` now
-- points here; 0024 and 0025 have shipped or will have.
--
-- One transaction, for 0024's reason: the CLI applies a migration statement by
-- statement, and a failure halfway would leave the table reseeded and the
-- functions old.
-- ---------------------------------------------------------------------------
begin;

alter table public.plans add column quiet_preset text;

update public.plans p
set quiet_preset = case
  when p.window_end = p.window_start then 'tonight'
  when p.window_end - p.window_start <= 2 then 'this_weekend'
  when p.window_end - p.window_start <= 6 then 'next_7_days'
  else 'next_14_days'
end
where p.mode = 'quiet' and p.quiet_preset is null;

update public.plans p
set quiet_expires_at = least(
  p.response_deadline,
  public.plan_last_possible_start(p.window_end, p.daily_end_local, p.duration_minutes, p.time_zone)
    - interval '1 minute'
)
where p.mode = 'quiet' and p.quiet_expires_at is null;

alter table public.plans
  add constraint plans_quiet_preset check (
    case mode
      when 'quiet' then quiet_preset is not null
        and quiet_preset in ('tonight', 'this_weekend', 'next_7_days', 'next_14_days')
      when 'named' then quiet_preset is null
      else false
    end
  ),
  add constraint plans_quiet_expires check (
    case mode
      when 'quiet' then state = 'draft' or quiet_expires_at is not null
      when 'named' then quiet_expires_at is null
      else false
    end
  ),
  add constraint plans_quiet_has_no_organiser check (
    case
      when mode = 'quiet' and state in ('draft', 'seeking') then organiser_user_id is null
      else true
    end
  );

comment on column public.plans.quiet_preset is
  'The window preset a quiet ask was made with, for the deadline it gets when it opens (defaultDeadline). Null on a named plan.';

-- The stop time is checked by the same trigger as the deadline, so it has to
-- fire when either moves — and when the state does, since the rule applies
-- only while `seeking`.
drop trigger plans_deadline_within_window on public.plans;
create trigger plans_deadline_within_window
  before insert or update of
    response_deadline, window_end, daily_end_local, duration_minutes, time_zone,
    quiet_expires_at, state
  on public.plans
  for each row execute function public.enforce_plan_deadline();

alter table jobs.notification_jobs
  drop constraint notification_jobs_kind,
  add constraint notification_jobs_kind check (kind in (
    'new_plan', 'quiet_ask', 'threshold_initiator', 'threshold_keen', 'deadline_approaching',
    'options_ready', 'replies_closed', 'locked_in', 'changed', 'cancelled', 'reminder',
    'did_it_happen', 'about_time', 'did_it_happen_participant', 'verify_email',
    'quiet_expired'
  ));

delete from planning.transitions;

-- BEGIN GENERATED: transitions (scripts/gen-transitions.mjs)
insert into planning.transitions (from_state, action, to_state, guards, bumps_revision) values
  ('draft', 'create_named', 'collecting', array['member','permanent','no_open_plan'], false),
  ('draft', 'create_quiet', 'seeking', array['member','permanent','no_open_plan'], false),
  ('seeking', 'threshold_reached', 'collecting', array['threshold','no_open_plan'], false),
  ('seeking', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'accept_organiser', 'collecting', array['member','permanent','no_organiser_yet','keen_initiator_or_owner'], false),
  ('ready', 'accept_organiser', 'ready', array['member','permanent','no_organiser_yet','keen_initiator_or_owner'], false),
  ('seeking', 'cancel', 'cancelled', array['member','initiator'], false),
  ('collecting', 'candidates_ready', 'ready', array[]::text[], false),
  ('collecting', 'edit', 'collecting', array['organiser'], true),
  ('collecting', 'adjust', 'collecting', array['organiser'], false),
  ('collecting', 'quorum_follows', 'collecting', array[]::text[], false),
  ('collecting', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'adjust', 'ready', array['organiser'], false),
  ('ready', 'quorum_follows', 'ready', array[]::text[], false),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('ready', 'expire', 'expired', array[]::text[], false),
  ('ready', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'reopen', 'collecting', array['organiser','no_open_plan'], true),
  ('confirmed', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('confirmed', 'report_outcome', 'completed', array['organiser'], false);
-- END GENERATED: transitions

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/planning/allowed_keys.sql
-- The payload keys an action may carry. Anything else is refused, not ignored:
-- a caller that sends `quorum` with a `cancel` has misunderstood something,
-- and silently dropping it would let the misunderstanding ship.
--
-- `confirm` carries the confirmation's details as well as the candidate,
-- because `transition_plan` writes the confirmation row itself.

create or replace function planning.allowed_keys(action text)
returns text[]
language sql
immutable
as $$
  select case
    -- `adjust` takes these two and *only* these two, which is what makes the
    -- split between "changes the question" and "changes what happens to the
    -- answers" structural rather than a comparison somebody has to remember
    -- (spec §5.3). A window cannot ride along on an adjustment.
    when action = 'adjust' then array['quorum', 'response_deadline']
    -- The quorum alone. `quorum_follows` is the circle moving a quorum nobody
    -- chose (ADR 0026); a deadline riding along on it would be a change no
    -- organiser asked for and nobody announced.
    when action = 'quorum_follows' then array['quorum']
    when action in ('edit', 'reopen') then array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local',
      'duration_minutes', 'quorum', 'response_deadline'
    ]
    when action = 'cancel' then array['cancel_note']
    -- A quiet ask opening is asked for times from that moment, so its deadline
    -- is set then: `defaultDeadline` for its window as of *now*, not as of when
    -- it was asked (`onThreshold`, spec §5.4.5). The only key it takes.
    when action = 'threshold_reached' then array['response_deadline']
    when action = 'confirm' then array['candidate_id', 'place_name', 'place_url', 'note', 'chased_answer']
    else array[]::text[]
  end;
$$;

revoke all on function planning.allowed_keys(text) from public;
revoke all on function planning.allowed_keys(text) from anon, authenticated;

-- supabase/sql/functions/planning/open_quiet_ask.sql
-- ---------------------------------------------------------------------------
-- A quiet ask's one crossing, attempted (spec §5.4.5, ADR 0035).
--
-- `nextQuietStep` and `recordInterest` in `packages/domain/src/planning`, in
-- the transaction that holds the plan's row: `true` if the ask opened, `false`
-- if it is below its threshold, past its stop time, or **held** — at its
-- threshold while another plan of the circle is `collecting` or `ready`
-- (ADR 0033). A held ask stays `seeking`, shows nothing, and is tried again on
-- the next answer (`record_interest`, a repeat included) and on every
-- dispatcher sweep (`dispatch_open_quiet_ask`), until it opens or its stop
-- time closes it.
--
-- **The caller holds the lock.** `transition_plan` takes `for update` on the
-- plan as well, and a re-lock in the same transaction is free; what matters is
-- that the count below is read after the lock was taken, so two answers
-- arriving together are counted one after the other and exactly one of them
-- crosses (SUS-24's note). The machine's own `threshold` guard counts the same
-- rows again, and is the authority; the count here only decides whether to ask
-- it, so that "below" never costs an exception.
--
-- `plan_in_progress` from the `no_open_plan` guard is "not yet", not a
-- failure (SUS-89): caught in its own block, so the answer that was recorded
-- stays recorded. Anything else is raised.
--
-- The deadline is the domain's (`defaultDeadline(preset, now, lastPossibleStart)`),
-- worked out by the caller before the lock and passed in: a second copy of the
-- rule in SQL would be one that drifts. `enforce_plan_deadline` still refuses
-- one after the last possible start.
-- ---------------------------------------------------------------------------

create or replace function planning.open_quiet_ask(p_plan_id uuid, p_deadline timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  keen integer;
begin
  -- The circle first, then the plan: the order `on_member_removed` takes them
  -- in, so an answer and a removal in one circle queue rather than deadlock
  -- (review round 4). The crossing's `no_open_plan` guard locks the circle
  -- again, which is free by then.
  perform 1 from public.circles c
  where c.id = (select p.circle_id from public.plans p where p.id = p_plan_id)
  for update;
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or plan.mode <> 'quiet' or plan.state <> 'seeking' then
    return false;
  end if;
  -- From its stop time an ask only expires (`nextQuietStep`), even before the
  -- sweep has written `expired`.
  if plan.quiet_expires_at is null or now() >= plan.quiet_expires_at or p_deadline is null then
    return false;
  end if;

  select count(*) into keen
  from private.plan_interest i
  where i.plan_id = plan.id and i.response = 'keen';
  if keen < plan.quiet_threshold then
    return false;
  end if;

  begin
    perform planning.transition_plan(
      plan.id, 'threshold_reached', null,
      jsonb_build_object('response_deadline', p_deadline)
    );
  exception when raise_exception then
    if sqlerrm = 'plan_in_progress' then
      return false;
    end if;
    raise;
  end;
  return true;
end;
$$;

comment on function planning.open_quiet_ask(uuid, timestamptz) is
  'Opens a seeking quiet ask that has met its threshold, with the given response deadline, unless it is past its stop time or held beside an open plan (ADR 0033, ADR 0035). True if it opened.';

revoke all on function planning.open_quiet_ask(uuid, timestamptz) from public;
revoke all on function planning.open_quiet_ask(uuid, timestamptz) from anon, authenticated;

-- supabase/sql/functions/public/accept_organiser.sql
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

-- supabase/sql/functions/public/create_quiet_ask.sql
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

-- supabase/sql/functions/public/dispatch_claim_due.sql
-- ---------------------------------------------------------------------------
-- The email jobs that are due, with the one address each is for.
--
-- Everything a send needs and nothing it does not. Three of the fields are
-- here because S1-18 found that the job alone is not enough to decide whether
-- to send it:
--
--   * `contact_status` — a suppression that lands after the job was written
--     leaves the job `scheduled`. "Permanent failure → skipped" (spec §9) is
--     evaluated when you send, not when the job was made.
--   * `subscribed` — and so is the consent. A `reminder` is written the moment
--     a meetup is confirmed and sits there for days; "Stop emails for this
--     meetup" withdraws the subscription and touches no job, so without this
--     the stop link would stop nothing that was already queued. It is
--     `private.email_recipients_for`, which is the one place the join is
--     written (S1-18), asked again at the moment of sending.
--   * `plan_state` — a verification queued while a plan was live is still
--     `scheduled` after the plan is cancelled, and sending it is a letter
--     about a meetup that is over.
--   * `circle_archived` — "Archiving stops all prompts" (spec §5.2), and a
--     reminder written before the owner archived is still `scheduled` after.
--     Asked at the moment of sending, so bringing the circle back lets what
--     was queued go rather than losing it (S1-23). The circle is the plan's,
--     or — for `about_time`, which has no plan — the job's own `circle_id`
--     (S2-04). Found through the plan alone, a cadence nudge's circle was
--     always null and archiving never stopped one.
--   * `organiser_email_muted` — the contact's owner has turned "Emails about
--     plans you organise" off (ADR 0029). `did_it_happen` is written when a
--     meetup is confirmed and sent the next morning, so a switch read only
--     when the job was written would not stop the letter it was turned off
--     for. Which kinds it stops is the domain's (`organiserEmailStopped`);
--     this says only whether it is off.
--   * `superseded` — "one copy per event" is the sender's job, not the
--     writer's. One address can be held by two contacts since 0009: two
--     siblings subscribed to the same decided plan, or a guest who joined
--     twice, produce two jobs for one mailbox. The flag marks a job whose
--     letter has **already gone** to that address.
--
--     Only `sent`, and that is the whole correction. It used to mark a job
--     whose sibling was merely `scheduled` and sorted earlier — which suppressed
--     the eligible copy when the earlier one turned out not to be: the first
--     was skipped for having left the circle, the second was skipped as a
--     duplicate of it, and the mailbox got nothing at all (review round 3).
--     A copy cannot be a duplicate of one that was never sent, so the
--     within-a-batch half of the rule belongs after eligibility, in the sender,
--     where it is keyed on the address a letter actually went to.
--
-- The dedupe is by `(kind, plan, revision, address)` and is applied only to
-- the kinds whose occurrence is *determined* by the plan revision —
-- `locked_in`, `cancelled`, `reminder`, `did_it_happen_participant`, and the
-- organiser kinds, which have one contact anyway. `changed` and `verify_email`
-- are excluded on purpose: both can legitimately occur twice in one revision
-- (a second material change, a second verification request), they are keyed by
-- change id and verification id for exactly that reason, and deduping them by
-- address is how nobody gets told the venue moved. `about_time` (Slice 2,
-- SUS-52) is excluded for a third reason: it belongs to a circle and has no
-- plan at all, so every one of them matches every other on
-- `plan_id is not distinct from null` and an address would receive exactly
-- one cadence nudge, ever. The sender holds the same three in
-- `NEVER_COLLAPSED`, because the rule has a half on each side of the wire;
-- they had drifted by one kind when review round 4 looked.
--
-- Push is not claimed here. Slice 1 writes no push job — a kind whose only
-- channel is push finds no device and produces no recipient — and Slice 3
-- (SUS-59) adds the Expo half with its own receipts.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_claim_due(p_limit integer default 50)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with due as (
    select j.*
    from jobs.notification_jobs j
    where j.status = 'scheduled'
      and j.channel = 'email'
      and j.scheduled_for <= now()
    order by j.scheduled_for, j.created_at, j.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'kind', j.kind,
    'contact_id', j.contact_id,
    'user_id', c.user_id,
    'plan_id', j.plan_id,
    'plan_revision', j.plan_revision,
    'idempotency_key', j.idempotency_key,
    'attempt_count', j.attempt_count,
    'email', c.email_normalized,
    'contact_status', c.status,
    'subscribed', exists (
      select 1 from private.email_recipients_for(j.plan_id) r where r.contact_id = j.contact_id
    ),
    -- `email_recipients_for` answers one question with three conditions in it,
    -- and the sender has to tell them apart: somebody who was removed from the
    -- circle withdrew nothing, and recording `subscription_withdrawn` against
    -- them tells whoever reads `last_error` the wrong story (review round 2).
    'member_active', exists (
      select 1 from public.circle_members m
      where m.circle_id = cir.id and m.user_id = c.user_id and m.status = 'active'
    ),
    'plan_state', p.state,
    'plan_short_code', p.short_code,
    'plan_current_revision', p.revision,
    'circle_id', cir.id,
    'circle_name', cir.name,
    'circle_archived', coalesce(cir.status = 'archived', false),
    -- The quiet ask's two letters to its initiator are stopped by muting quiet
    -- asks in that circle (`QUIET_SENSITIVE_KINDS`), read now rather than when
    -- the job was written, as the organiser switch is (SUS-50 review round 2).
    'quiet_asks_muted', coalesce((
      select m.muted_quiet_asks or m.muted_all from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = c.user_id and m.status = 'active'
    ), false),
    'organiser_email_muted', coalesce((
      select pr.muted_organiser_email from public.profiles pr where pr.user_id = c.user_id
    ), false),
    'superseded', j.kind not in ('changed', 'verify_email', 'about_time') and exists (
      select 1
      from jobs.notification_jobs o
      join private.email_contacts oc on oc.id = o.contact_id
      where o.id <> j.id
        and o.kind = j.kind
        and o.plan_id is not distinct from j.plan_id
        and o.plan_revision is not distinct from j.plan_revision
        and oc.email_hash = c.email_hash
        and o.status = 'sent'
    )
  ) order by j.scheduled_for, j.created_at, j.id), '[]'::jsonb)
  from due j
  join private.email_contacts c on c.id = j.contact_id
  left join public.plans p on p.id = j.plan_id
  left join public.circles cir on cir.id = coalesce(p.circle_id, j.circle_id);
$$;

comment on function public.dispatch_claim_due(integer) is
  'The due email jobs, each with its address, the contact''s status now, the plan''s state now, whether its owner has turned organiser email off, and whether an earlier job already covers this address for this event. Service role only (S1-20).';

revoke all on function public.dispatch_claim_due(integer) from public;
revoke all on function public.dispatch_claim_due(integer) from anon, authenticated;
grant execute on function public.dispatch_claim_due(integer) to service_role;

-- supabase/sql/functions/public/dispatch_open_quiet_ask.sql
-- ---------------------------------------------------------------------------
-- The sweep's half of a held quiet ask (ADR 0035).
--
-- An ask that met its threshold while the circle had a plan finding a time
-- stayed `seeking`. `dispatch_timed_work` names the held asks whose circle is
-- free again; the dispatcher works out each one's deadline with the domain's
-- `defaultDeadline` and hands it here, and `planning.open_quiet_ask` tries the
-- crossing again under the plan's lock — the same attempt an answer makes, so
-- a sweep and an answer arriving together open it once between them.
--
-- The other half is every answer: `record_interest` tries the same crossing
-- on each one, a repeat included. Between them a held ask opens within a
-- minute of its circle coming free, and from its stop time it only expires.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_open_quiet_ask(p_plan_id uuid, p_deadline timestamptz)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select planning.open_quiet_ask(p_plan_id, p_deadline);
$$;

comment on function public.dispatch_open_quiet_ask(uuid, timestamptz) is
  'Tries again to open a held quiet ask, with the response deadline the domain gives it now. True if it opened. Service role only (S2-02).';

revoke all on function public.dispatch_open_quiet_ask(uuid, timestamptz) from public;
revoke all on function public.dispatch_open_quiet_ask(uuid, timestamptz) from anon, authenticated;
grant execute on function public.dispatch_open_quiet_ask(uuid, timestamptz) to service_role;

-- supabase/sql/functions/public/dispatch_quiet_audience.sql
-- ---------------------------------------------------------------------------
-- The two facts a quiet-ask message needs to find its audience, and only for
-- the kind being addressed (S1-20's note on SUS-50).
--
-- `dispatch_context` deliberately carries neither: it is loaded for every
-- plan every run, and a value that holds the initiator is a value that can end
-- up somewhere it should not. This is read by the drain only when an intent's
-- kind is one of the four that need it, merged into that one eligibility
-- question, and dropped:
--
--   * `quiet_ask` — the initiator, to leave them out of the prompt;
--   * `threshold_initiator`, `quiet_expired` — the initiator, who is the
--     audience;
--   * `threshold_keen` — the keen members, and the initiator, who has their
--     own message and is left out of this one.
--
-- Any other kind gets nothing. The ids go into `recipientsFor` and come out as
-- recipients; a job is keyed on its recipient, so for `threshold_initiator`
-- and `quiet_expired` the row names the initiator's contact — which is fine,
-- because that row is theirs — and nothing else carries it: not a payload, not
-- a log line, not another job.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_quiet_audience(p_plan_id uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'initiator_user_id', case
      when p_kind in ('quiet_ask', 'threshold_initiator', 'threshold_keen', 'quiet_expired') then (
        select pi.initiator_user_id from private.plan_initiators pi
        join public.plans p on p.id = pi.plan_id
        where pi.plan_id = p_plan_id and p.mode = 'quiet'
      )
    end,
    'keen_user_ids', case
      when p_kind = 'threshold_keen' then coalesce((
        select jsonb_agg(i.user_id order by i.user_id) from private.plan_interest i
        join public.plans p on p.id = i.plan_id
        where i.plan_id = p_plan_id and p.mode = 'quiet' and i.response = 'keen'
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  );
$$;

comment on function public.dispatch_quiet_audience(uuid, text) is
  'For one quiet-ask notification kind, the initiator and/or keen member ids its audience rule needs, and nothing for any other kind. Never logged, never written into a job. Service role only (S2-02).';

revoke all on function public.dispatch_quiet_audience(uuid, text) from public;
revoke all on function public.dispatch_quiet_audience(uuid, text) from anon, authenticated;
grant execute on function public.dispatch_quiet_audience(uuid, text) to service_role;

-- supabase/sql/functions/public/dispatch_timed_work.sql
-- ---------------------------------------------------------------------------
-- The work a clock creates, discovered from data rather than from a timer
-- (architecture §9.3).
--
-- Five things, every run, all of them queries:
--
-- 1. **A deadline that has passed.** Nothing emits `planning.deadline_passed`
--    — it is not a transition, and S1-11 left it for the sweep to raise. It is
--    emitted into the outbox rather than turned into a job here, so that the
--    one place events become notifications stays the drain. Once per
--    **deadline**, not once per plan: "give it one more day" (spec §5.7) moves
--    the deadline out and it passes again, and a marker keyed on the plan
--    would announce the second one to nobody. The outbox is still the marker,
--    which holds because a plan cannot outlive its own window by the thirty
--    days retention keeps events for (rule 2 below closes it long before).
--
-- 2. **A plan whose last possible start has gone.** Spec §9: "the plan stays
--    decidable until the last candidate start, then expires." The last start
--    is `public.plan_last_possible_start` — the same function the deadline
--    constraint uses, so the moment a plan stops being decidable and the
--    moment it may no longer be answered are one definition rather than two.
--    `expire` has no guards, so the actor is null: nobody did this, the window
--    closed.
--
-- 3. **A plan whose candidate set is stale.** After ADR 0018 every answer
--    recalculates in the request that caused it, and the cases with no request
--    to attach to are this function's: a member removed by a trigger, a
--    recalculation that lost its compare-and-set. Found by asking which plans
--    have no `candidate_sets` row at the version they are on (S1-16).
--
-- 4. **A deadline 24 hours out.** The plans, not the people: who is owed a
--    reminder is `recipientsFor('deadline_approaching')`'s answer and belongs
--    in the domain.
--
-- 5. **A circle that may be due a nudge** (S2-04). The circles, not the
--    decision: whether one is owed, for which due date and to whom is
--    `nudgeDueDate` and `nudgeChoice`'s, in the domain. This is a coarse
--    superset of the circles that could be owed one, so the domain is asked
--    about few circles rather than all of them: active, with a goal and a
--    history, nothing open, not snoozed, not already decided for this cycle
--    (the prompt counted from its current `last_met_at`) — and met long
--    enough ago that the lead window can have opened. That last bound is the
--    domain's own arithmetic: the cadence added forward from the meetup on the
--    circle's wall clock, where a month is a calendar month clamped at its
--    end, less the lead days, less one more day for a DST hour. So no circle
--    the domain would call due is ever left out or named late; one it would
--    not is merely asked about and told no. Subtracting a month back from
--    now instead named a circle that met at the start of February two days
--    after its card appeared (review round 2). Oldest first, so a circle that
--    has waited longest is asked first.
-- 6. **A quiet ask at its stop time** (SUS-50). Plans
--    `seeking` whose `quiet_expires_at` has passed expire, privately — the
--    one message is the initiator's, and it comes from the drain reading the
--    `planning.plan_expired` this writes. And the asks **held** at their
--    threshold beside an open plan (ADR 0035) whose circle is free again are
--    named, with what the domain needs to give each its deadline; the
--    dispatcher opens them through `dispatch_open_quiet_ask`.
--
-- Each transition is attempted on its own and a refusal is counted rather than
-- thrown: a plan that was confirmed between the select and the update is a
-- race with a correct outcome, and losing it must not abandon the rest of the
-- batch.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_timed_work(p_limit integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  batch integer := greatest(1, least(coalesce(p_limit, 50), 200));
  target record;
  closed integer := 0;
  expired integer := 0;
  refused integer := 0;
  quiet_expired integer := 0;
begin
  for target in
    select p.id, p.circle_id, p.revision, p.response_deadline
    from public.plans p
    where p.state in ('collecting', 'ready')
      and p.response_deadline <= now()
      and not exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed'
          and o.aggregate_id = p.id
          and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
      )
    order by p.response_deadline
    limit batch
  loop
    perform jobs.emit('planning.deadline_passed', 'plan', target.id, jsonb_build_object(
      'plan_id', target.id, 'circle_id', target.circle_id, 'revision', target.revision,
      -- The marker, and the reason it is in the payload rather than implied by
      -- the row: spec §5.7's replies-closed screen offers "give it one more
      -- day", and an extended deadline passes a second time. Keyed on the plan
      -- alone, the second one is announced to nobody — and the organiser's only
      -- channel in Slice 1 is this letter. An instant is an allowed payload
      -- value: `jobs.carries_content` takes `[A-Za-z0-9_./:+-]` up to 40, and
      -- this is 32.
      --
      -- **To the microsecond, and rendered rather than cast.** The first
      -- version of this used `OF:00` and lost the fraction, so the comparison
      -- below — which is at full precision — never matched a marker it had
      -- written itself, and every plan with a fractional deadline was
      -- announced again every minute for as long as it stayed open. Almost
      -- every deadline is fractional: `defaultDeadline` is `now + 1h`. Found
      -- in review round 2, and it is why the round-2 test runs the sweep twice
      -- against one deadline rather than once against two.
      --
      -- Rendered in UTC with an explicit offset rather than left to jsonb's
      -- own cast, which would use the session's `TimeZone` and make the stored
      -- string depend on who called.
      'deadline', to_char(target.response_deadline at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')));
    closed := closed + 1;
  end loop;

  for target in
    select p.id
    from public.plans p
    where p.state in ('collecting', 'ready')
      and public.plan_last_possible_start(
            p.window_end, p.daily_end_local, p.duration_minutes, p.time_zone) <= now()
    order by p.window_end
    limit batch
  loop
    begin
      perform planning.transition_plan(target.id, 'expire', null);
      expired := expired + 1;
    exception when others then
      refused := refused + 1;
    end;
  end loop;

  -- Quiet asks (SUS-50) ------------------------------------------------------
  -- From its stop time an ask only expires (`nextQuietStep`), held or not.
  -- `('seeking', 'expire')` has no guards, so the actor is null; `event_for`
  -- names it `planning.plan_expired`, whose `from_state` tells the drain it
  -- never opened.
  for target in
    select p.id
    from public.plans p
    where p.mode = 'quiet' and p.state = 'seeking' and p.quiet_expires_at <= now()
    order by p.quiet_expires_at
    limit batch
  loop
    begin
      -- Re-read under the lock: an answer that crossed the threshold a moment
      -- before the stop time may have opened it since the select, and
      -- `collecting → expire` has no guards (review round 4).
      perform 1 from public.plans p
      where p.id = target.id and p.state = 'seeking' and p.quiet_expires_at <= now()
      for update;
      if found then
        perform planning.transition_plan(target.id, 'expire', null);
        quiet_expired := quiet_expired + 1;
      end if;
    exception when others then
      refused := refused + 1;
    end;
  end loop;
  -- End quiet asks (SUS-50) --------------------------------------------------

  return jsonb_build_object(
    'quiet_expired', quiet_expired,
    -- Held asks whose circle has no plan `collecting` or `ready` now: at their
    -- threshold, before their stop time. The timing is what `defaultDeadline`
    -- needs; the count and the answers stay here (SUS-50).
    'held', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'preset', x.quiet_preset, 'window_start', x.window_start,
        'window_end', x.window_end, 'daily_start_local', x.daily_start_local,
        'daily_end_local', x.daily_end_local, 'duration_minutes', x.duration_minutes,
        'time_zone', x.time_zone
      )) from (
        select p.*
        from public.plans p
        where p.mode = 'quiet' and p.state = 'seeking' and p.quiet_expires_at > now()
          and (
            select count(*) from private.plan_interest i
            where i.plan_id = p.id and i.response = 'keen'
          ) >= p.quiet_threshold
          and not exists (
            select 1 from public.plans o
            where o.circle_id = p.circle_id and o.id <> p.id and o.state in ('collecting', 'ready')
          )
        order by p.quiet_expires_at
        limit batch
      ) x
    ), '[]'::jsonb),
    'deadline_passed', closed,
    'expired', expired,
    'expire_refused', refused,
    'stale', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and not exists (
            select 1 from public.candidate_sets cs
            where cs.plan_id = p.id
              and cs.revision = p.revision
              and cs.input_version = p.input_version
          )
        order by p.updated_at
        limit least(batch, 20)
      ) x
    ), '[]'::jsonb),
    'approaching', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and p.response_deadline > now()
          and p.response_deadline <= now() + interval '24 hours'
        order by p.response_deadline
        limit batch
      ) x
    ), '[]'::jsonb),
    'cadence', coalesce((
      select jsonb_agg(x.id) from (
        select c.id
        from public.circles c
        where c.status = 'active'
          and c.cadence <> 'none'
          and c.last_met_at is not null
          and ((c.last_met_at at time zone c.time_zone) + case c.cadence
            when 'weekly' then interval '7 days'
            when 'fortnightly' then interval '14 days'
            when 'monthly' then interval '1 month'
            else interval '2 months'
          end - case c.cadence
            when 'weekly' then interval '3 days'
            when 'fortnightly' then interval '3 days'
            else interval '8 days'
          end) at time zone c.time_zone <= now()
          and (c.cadence_snoozed_until is null or c.cadence_snoozed_until <= now())
          and not exists (
            select 1 from public.plans p
            where p.circle_id = c.id
              and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
          )
          and not exists (
            select 1 from private.cadence_prompts cp
            where cp.circle_id = c.id and cp.last_met_at = c.last_met_at
          )
        order by c.last_met_at
        limit batch
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.dispatch_timed_work(integer) is
  'One pass of the time-based work: emits planning.deadline_passed once per plan, expires plans whose last possible start has gone and quiet asks whose stop time has, and names the plans with a stale candidate set or a deadline within 24 hours, the circles that may be due a cadence nudge, and the held quiet asks whose circle is free. Service role only (S1-20, S2-02, S2-04).';

revoke all on function public.dispatch_timed_work(integer) from public;
revoke all on function public.dispatch_timed_work(integer) from anon, authenticated;
grant execute on function public.dispatch_timed_work(integer) to service_role;

-- supabase/sql/functions/public/enforce_plan_deadline.sql
create or replace function public.enforce_plan_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest_start timestamptz := public.plan_last_possible_start(
    new.window_end, new.daily_end_local, new.duration_minutes, new.time_zone
  );
begin
  if new.response_deadline > latest_start then
    raise exception 'response deadline % is after the last possible start %',
      new.response_deadline, latest_start
      using errcode = 'check_violation';
  end if;

  -- A quiet ask's stop time, while it is asking (spec §5.4, ADR 0035): set,
  -- and strictly before the last possible start — an ask that opened once
  -- nobody could meet would be an ask about nothing. Here and not in a check
  -- constraint for the reason above: the last possible start is a wall-clock
  -- time in the plan's zone, which is stable rather than immutable.
  --
  -- A `case` that answers `true` for a null stop time, not a comparison that
  -- answers null for one, because plpgsql's `if null` is `if false` and a
  -- quiet ask with no stop time would have walked straight through (SUS-24,
  -- SUS-49). Only while `seeking`: once it opens, the stop time is history and
  -- the plan runs to its deadline like any other. In parentheses because
  -- plpgsql reads an `if` condition up to its first `then`, and the `case`
  -- has one of its own.
  if (case
    when new.mode = 'quiet' and new.state = 'seeking' then
      new.quiet_expires_at is null or new.quiet_expires_at >= latest_start
    else false
  end) then
    raise exception 'stop_time_unavailable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_plan_deadline() is
  'A deadline never runs past the last possible start (spec §5.3), and a seeking quiet ask stops asking strictly before it (ADR 0035): replies that arrive once the plan cannot happen are replies to nothing.';

revoke all on function public.enforce_plan_deadline() from public;
revoke all on function public.enforce_plan_deadline() from anon, authenticated;

-- supabase/sql/functions/public/on_member_removed.sql
-- ---------------------------------------------------------------------------
-- Removal: every consequence, in one trigger.
--
-- Spec §4.5 — a removed member "loses circle and plan access immediately;
-- historic aggregate attendance may remain; their availability is deleted."
-- Four things follow, and they are here together rather than in four triggers
-- because they cannot be correct separately:
--
--   * their responses and windows go — the cascade takes the windows, and the
--     bump triggers stale every candidate set that counted them;
--   * they leave the participant list of every plan revision still open, so
--     the dispatcher stops treating them as a non-responder;
--   * a `ready` plan they had answered goes back to `collecting`, because its
--     set may have needed them for quorum, and `confirm` must not lock in a
--     time that depended on somebody who has left;
--   * on a confirmation still ahead, `going` or `unknown` becomes `cant` — a
--     `going` from them would keep them in "5 going" and on the reminder list.
--     History is untouched: answers about evenings that have happened, and
--     rows on closed confirmations, stay exactly as they were.
--
-- The circle row and then the plan rows are locked first, so a removal racing a
-- first answer cannot let the answer land behind it — and nor can a removal
-- racing a *new plan*. Locking the plans alone was not enough for that one:
-- `create_plan` reads the circle's active members and inserts its participant
-- rows in a transaction this trigger cannot see, so a removal committing in the
-- middle of it locked nothing the creation held, deleted nothing that existed
-- yet, and left the departed member on the roster of a plan created after they
-- had gone. `create_plan` takes the circle row for update for its own reasons;
-- taking the same one here is what makes the two wait for each other.
--
-- Circle before plans, which is the order `create_plan` locks in too. Two
-- transactions taking the same locks in the same order cannot deadlock over
-- them.
-- ---------------------------------------------------------------------------

create or replace function public.on_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected uuid;
begin
  if new.status <> 'removed' or old.status = 'removed' then
    return new;
  end if;

  perform 1 from public.circles c where c.id = new.circle_id for update;
  perform 1 from public.plans p where p.circle_id = new.circle_id for update;

  delete from public.plan_responses r
  using public.plans p
  where r.plan_id = p.id
    and p.circle_id = new.circle_id and r.user_id = new.user_id;

  update public.plans p
  set input_version = p.input_version + 1
  where p.circle_id = new.circle_id
    and p.state in ('seeking', 'collecting', 'ready');

  -- Their answer to a quiet ask still asking goes with them (architecture
  -- §9.1: removal deletes answers to plans still asking). Left, a departed
  -- member's `keen` went on counting toward the threshold, and could open an
  -- ask the circle as it now is had not reached (SUS-50 review round 1). An
  -- ask that has opened keeps its rows: interest closed when it opened, and
  -- the count shown from then on is the one it opened with.
  delete from private.plan_interest i
  using public.plans p
  where i.plan_id = p.id and i.user_id = new.user_id
    and p.circle_id = new.circle_id and p.state = 'seeking';

  -- An organiser removed from a quiet plan that has opened and not been
  -- locked in leaves the role free, so somebody keen can take it again
  -- (`accept_organiser`). Left, the plan named a person who could no longer
  -- see it and refused every active member `already_taken` — stranded (SUS-50
  -- review round 2). Only the quiet plan: its role is one somebody *accepts*,
  -- and accepting is the way back. A named plan's organiser is the person who
  -- made it; handing that on is SUS-53's.
  update public.plans p
  set organiser_user_id = null
  where p.circle_id = new.circle_id and p.organiser_user_id = new.user_id
    and p.mode = 'quiet' and p.state in ('collecting', 'ready');

  delete from public.plan_participants pp
  using public.plans p
  where pp.plan_id = p.id and pp.revision = p.revision and pp.user_id = new.user_id
    and p.circle_id = new.circle_id
    and p.state in ('seeking', 'collecting', 'ready');

  for affected in
    select p.id from public.plans p
    where p.circle_id = new.circle_id and p.state = 'ready'
  loop
    perform planning.transition_plan(affected, 'candidates_gone', new.user_id);
  end loop;

  -- Not coming to anything still ahead. History is left exactly as it was:
  -- `was_there` and `missed`, rows on closed confirmations, and rows on a
  -- meetup that has ended but not yet been reported on — `active` alone does
  -- not mean "ahead", and a `going` from last Thursday is part of the historic
  -- aggregate §4.5 lets remain.
  update public.attendance a
  set status = 'cant', updated_at = now()
  from public.meetup_confirmations c
  join public.plans p on p.id = c.plan_id
  where a.confirmation_id = c.id
    and a.user_id = new.user_id
    and p.circle_id = new.circle_id
    and c.status = 'active'
    and c.ends_at > now()
    and a.status in ('going', 'unknown');

  return new;
end;
$$;

revoke all on function public.on_member_removed() from public;
revoke all on function public.on_member_removed() from anon, authenticated;

-- supabase/sql/functions/public/quiet_viewer_facts.sql
-- ---------------------------------------------------------------------------
-- The three facts about one viewer of a quiet ask that only `private` holds,
-- for `quiet-view` to build that viewer's `quietView` with (spec §5.4).
--
-- `quietView` in `packages/domain/src/planning/quiet-view.ts` turns them into
-- what the viewer may see — "answered", never *what*; "may withdraw", never
-- "is the initiator" — and **the raw facts never leave the server** (review
-- round 1): this is the service role's, called by the Edge Function with the
-- verified caller's id, and the function returns the view and nothing else.
--
--   * `is_initiator` — whether this viewer started it;
--   * `my_answer` — this viewer's own answer, or null;
--   * `ever_opened` — for an `expired` quiet plan, whether it had crossed its
--     threshold first (SUS-49 note 11): an ask that opened and later ran past
--     its last start did not "close quietly". From the outbox: `true` if the
--     crossing was announced, `false` if the expiry was announced from
--     `seeking`, null when neither is there any more (retention keeps thirty
--     days), and `quietView` shows no notice for unknown.
--
-- Null for a named plan, or a viewer who is not an active member of its
-- circle.
-- ---------------------------------------------------------------------------

create or replace function public.quiet_viewer_facts(p_plan_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_initiator', exists (
      select 1 from private.plan_initiators pi
      where pi.plan_id = p.id and pi.initiator_user_id = p_user_id
    ),
    'my_answer', (
      select i.response from private.plan_interest i
      where i.plan_id = p.id and i.user_id = p_user_id
    ),
    'ever_opened', case
      when p.state <> 'expired' then null
      when exists (
        select 1 from jobs.outbox o
        where o.aggregate_id = p.id and o.event_name = 'planning.threshold_reached'
      ) then true
      when exists (
        select 1 from jobs.outbox o
        where o.aggregate_id = p.id and o.event_name = 'planning.plan_expired'
          and o.payload ->> 'from_state' = 'seeking'
      ) then false
      else null
    end
  )
  from public.plans p
  where p.id = p_plan_id
    and p.mode = 'quiet'
    and exists (
      select 1 from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = p_user_id and m.status = 'active'
    );
$$;

comment on function public.quiet_viewer_facts(uuid, uuid) is
  'For one viewer of a quiet ask: whether they started it, their own answer, and for an expired one whether it had opened — the inputs quietView needs from private. Never returned to a client. Service role only (S2-02).';

revoke all on function public.quiet_viewer_facts(uuid, uuid) from public;
revoke all on function public.quiet_viewer_facts(uuid, uuid) from anon, authenticated;
grant execute on function public.quiet_viewer_facts(uuid, uuid) to service_role;

-- supabase/sql/functions/public/record_interest.sql
-- ---------------------------------------------------------------------------
-- A member's private answer to a quiet ask, and the threshold evaluated in the
-- same transaction (spec §5.4, architecture §9.1 `answer-interest`).
--
-- `recordInterest` in `packages/domain/src/planning/quiet.ts`, under the
-- plan's row lock, which is what makes "exactly once" true: fifty answers
-- arriving together queue on the lock, each counts what the one before it
-- wrote, and the first to find the threshold met is the one that crosses. The
-- rest find the plan `collecting` and are told interest has closed.
--
-- **The answer is the only thing that goes back, and it has no count in it.**
-- `threshold_reached` is false for "one more needed", "ten more needed" and
-- "held beside an open plan" alike (`InterestReceipt`), so two answers read
-- side by side cannot be differenced to find the person between them.
--
-- The refusals, in order:
--
--   * `plan_not_found` — no such plan, or not one of the caller's circles. One
--     answer for both, so a plan id is not a way to learn a circle exists.
--   * `not_quiet` — a named plan has no interest to record.
--   * `interest_closed` — the ask is not `seeking`, or has reached its stop
--     time. At or after `quiet_expires_at` it is closed even before the sweep
--     writes `expired` (SUS-49 note 5), and once it has opened it is closed for
--     good, which is what keeps the post-threshold count a constant.
--   * `initiator_is_keen` — the initiator counts as keen from creation and
--     stays so; to stop, they withdraw (`cancel-plan`).
--
-- A repeat is not an error and changes nothing but the attempt: the ask is
-- re-evaluated on every answer, because a held ask opens on the first answer
-- after the circle's open plan finishes (ADR 0035).
--
-- **Service role only**, with the actor passed in by `answer-interest` from
-- the verified JWT. The deadline an opening ask gets is the domain's, and a
-- function a client could call directly would be a function a client could
-- hand any deadline it liked.
--
-- Emits nothing of its own. The architecture's catalogue names
-- `planning.interest_recorded`, and it is deliberately not raised: an event
-- per answer is a clock on who answered when, which is a way of telling who
-- was keen by who was online. The crossing's own event is `transition_plan`'s.
-- ---------------------------------------------------------------------------

create or replace function public.record_interest(
  p_plan_id uuid,
  p_actor uuid,
  p_interested boolean,
  p_deadline_if_opened timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  answer text := case when p_interested then 'keen' else 'not_this_time' end;
begin
  if p_actor is null or p_interested is null then
    raise exception 'record_interest needs an actor and an answer'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The circle first, then the plan: the order `on_member_removed` takes them
  -- in, so an answer and a removal in one circle queue rather than deadlock
  -- (review round 4). The crossing's `no_open_plan` guard locks the circle
  -- again, which is free by then.
  perform 1 from public.circles c
  where c.id = (select p.circle_id from public.plans p where p.id = p_plan_id)
  for update;
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = p_actor and m.status = 'active'
  ) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  if plan.mode <> 'quiet' then
    raise exception 'not_quiet' using errcode = 'P0001';
  end if;

  if (case
    when plan.state = 'seeking' then plan.quiet_expires_at is null or now() >= plan.quiet_expires_at
    else true
  end) then
    raise exception 'interest_closed' using errcode = 'P0001';
  end if;

  if answer <> 'keen' and exists (
    select 1 from private.plan_initiators pi
    where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
  ) then
    raise exception 'initiator_is_keen' using errcode = 'P0001';
  end if;

  insert into private.plan_interest as i (plan_id, user_id, response)
  values (plan.id, p_actor, answer)
  on conflict (plan_id, user_id) do update
    set response = excluded.response,
        responded_at = case
          when i.response is distinct from excluded.response then now()
          else i.responded_at
        end;

  return jsonb_build_object(
    'threshold_reached', planning.open_quiet_ask(plan.id, p_deadline_if_opened)
  );
end;
$$;

comment on function public.record_interest(uuid, uuid, boolean, timestamptz) is
  'Records one member''s private answer to a seeking quiet ask and, in the same transaction, opens the ask if its threshold is met and the circle has no open plan. Returns only whether it opened. Service role only (S2-02).';

revoke all on function public.record_interest(uuid, uuid, boolean, timestamptz) from public;
revoke all on function public.record_interest(uuid, uuid, boolean, timestamptz) from anon, authenticated;
grant execute on function public.record_interest(uuid, uuid, boolean, timestamptz) to service_role;

-- END GENERATED: function definitions

commit;
