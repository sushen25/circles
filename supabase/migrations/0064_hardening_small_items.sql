-- 0064_hardening_small_items
--
-- SUS-125: small hardening. Numbered 0064 rather than 0057 because open PRs hold
-- 0057 to 0063; renumber if the merge order changes.
--
-- 1. Members read `circles` by column, and `creation_key` is not one of them.
--    It is the creator's idempotency key (architecture §9.1): scoped to its
--    owner and harmless, and also not something a client has any use for.
--    The table was granted whole, so a new column was readable the day it was
--    added; now a column is readable when somebody lists it here.
-- 2. `circles_no_anonymous_insert` stays and says why.
-- 3. Plan short codes are drawn by rejection sampling (create_plan,
--    create_quiet_ask), `take_rate_token` explains its fixed windows, and
--    `reissue_invite` is the service role's half of rotating a leaked invite
--    key. All three arrive in the generated block below.
--
-- `pg_net` stays executable by `anon` and `authenticated`, and this migration
-- cannot change that: `net.http_get` and `net.http_post` are granted by
-- `supabase_admin`, who owns the schema, and the migration role is neither that
-- role nor a member of it, so a `revoke` here changes nothing and only warns.
-- `supabase/tests/database/480_small_hardening.sql` pins what can be pinned instead:
-- no function of ours calls `net.*` except the scheduler's.

revoke select on public.circles from authenticated;
grant select (
  id, owner_user_id, name, color, time_zone, cadence, nudge_policy,
  default_duration_minutes, default_quorum, default_area, status, last_met_at,
  cadence_snoozed_until, short_code, created_at, updated_at
) on public.circles to authenticated;

comment on policy circles_no_anonymous_insert on public.circles is
  'Defence in depth (ADR 0004). Nothing applies it today, because no client role has an INSERT grant on circles; it is here so that a future insert policy, or grant, still cannot let an anonymous caller create a circle.';

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/create_circle.sql
-- ---------------------------------------------------------------------------
-- create_circle
--
-- The only way a circle comes into existence. A definer function rather than an
-- insert policy, because a circle and its owner's membership have to appear
-- together — an insert policy would leave a window in which a circle exists
-- with no members and therefore no one who can see it.
--
-- The invite link is here for the same reason, one step further out. Spec §5.1
-- makes the circle and the link one step of one flow, and `create-circle` used
-- to make them with two RPCs: a failure between them left a circle nobody could
-- be invited to, a `circles.circle_created` event about it, and a person looking
-- at an error message. Given a digest, the link is issued in this transaction,
-- so the answer to "did that work?" is the same answer for both.
-- ---------------------------------------------------------------------------

create or replace function public.create_circle(
  name text,
  color text,
  time_zone text,
  -- Required, and therefore ahead of the optional cadence. §9.1 has every
  -- mutation idempotent on a client-supplied key, and an optional one is a key
  -- nobody sends: the retry it guards against is the one where the client never
  -- saw a response and cannot tell a timeout from a failure.
  idempotency_key text,
  cadence text default 'none',
  -- SHA-256 of the invite secret, which the server never sees (§14). Optional
  -- because a circle is a circle without a link — fixtures and tests make them
  -- that way — and passed by `create-circle` always, because the flow it serves
  -- promises both.
  invite_secret_hash bytea default null,
  -- The invite's id, when the secret was derived from it (ADR 0028): what lets
  -- the owner be shown this link again. Absent, the link is issued with an id
  -- of its own and can only ever be reset.
  invite_id uuid default null,
  -- "Where, roughly" on CreateCircle (S1-23): a loose area, optional. Blank is
  -- no answer, not an empty place.
  default_area text default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The `ShortCode` contract's alphabet (`packages/contracts/src/ids.ts`).
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  caller uuid := (select auth.uid());
  caller_name text;
  created public.circles;
  code text;
  i integer;
  pick integer;
begin
  if not public.auth_is_permanent() then
    -- The organiser gate (ADR 0004). Worded as a practical need by the client;
    -- here it is simply a refusal.
    raise exception 'creating a circle needs a saved place'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'create_circle_sql', extensions.digest(caller::text, 'sha256'), 60, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  if coalesce(btrim(create_circle.idempotency_key), '') = '' then
    raise exception 'create_circle needs an idempotency key'
      using errcode = 'null_value_not_allowed';
  end if;

  -- A retry returns what the first attempt made. Creating a circle is the one
  -- mutation where a lost response is expensive: the client cannot tell a
  -- timeout from a failure, and trying again would leave the person with two
  -- circles and no way to tell which one they gave the link out for.
  select * into created
  from public.circles c
  where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
  if found then
    return created;
  end if;

  select p.display_name into caller_name from public.profiles p where p.user_id = caller;
  if caller_name is null then
    raise exception 'no profile for %', caller using errcode = 'foreign_key_violation';
  end if;

  -- Ten characters from the `ShortCode` alphabet — no `0`/`o`, no `1`/`l`/`i`,
  -- because a short code is read aloud and retyped. Not a secret and not
  -- required to be unguessable: the invite secret is the capability, and it
  -- never reaches a server (§14). The loop retries on collision rather than
  -- hoping there is none.
  loop
    code := '';
    for i in 1..10 loop
      -- Rejection sampling: a byte is 0..255 and 256 is not a multiple of 31,
      -- so `% 31` would favour the first eight letters. Bytes from the last,
      -- partial run are thrown away and redrawn (about 3% of them).
      loop
        pick := get_byte(extensions.gen_random_bytes(1), 0);
        exit when pick < (256 / length(alphabet)) * length(alphabet);
      end loop;
      code := code || substr(alphabet, 1 + (pick % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.circles c where c.short_code = code);
  end loop;

  insert into public.circles
    (owner_user_id, name, color, time_zone, cadence, short_code, creation_key, default_area)
  values (caller, create_circle.name, create_circle.color, create_circle.time_zone,
          create_circle.cadence, code, create_circle.idempotency_key,
          nullif(btrim(create_circle.default_area), ''))
  returning * into created;

  insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
  values (created.id, caller, caller_name, 'owner');

  -- The link, in the same transaction, through the function that owns what
  -- issuing one means: the audit row, the revocation of any earlier link, and
  -- the rule that the first link announces nothing because the circle's own
  -- creation already did. It checks that the caller owns the circle, which they
  -- do — they are two statements away from having made it.
  if create_circle.invite_secret_hash is not null then
    perform public.issue_invite(
      created.id, create_circle.invite_secret_hash, create_circle.invite_id
    );
  end if;

  -- `circles.circle_created` and `circles.member_joined` are written to
  -- `jobs.outbox` by the row triggers in 0006, in this transaction — on the
  -- rows rather than here, so that every writer of a circle or a membership
  -- announces it, not only this function.

  return created;

exception
  when unique_violation then
    -- Two identical requests in flight at once: the index caught the second, and
    -- the row the first one wrote is the answer.
    select * into created
    from public.circles c
    where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
    if found then
      return created;
    end if;
    raise;
end;
$$;

comment on function public.create_circle(text, text, text, text, text, bytea, uuid, text) is
  'Creates a circle, its owner membership and — given a digest — its invite link, in one transaction. Requires a permanent identity (ADR 0004).';

revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text) from public;
revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text) from anon, authenticated;
grant execute on function public.create_circle(text, text, text, text, text, bytea, uuid, text) to authenticated;

-- supabase/sql/functions/public/create_plan.sql
-- ---------------------------------------------------------------------------
-- A plan comes into existence in `draft` and is moved out of it by the machine.
--
-- Not "insert with state `collecting`". `draft → create_named → collecting` is a
-- row in `planning.transitions`, with its guards (an active member, a saved
-- place — ADR 0004) and its event (`planning.plan_created`) attached to it. A
-- function that set the state itself would be a second creation path with its
-- own idea of who may create and whether anybody is told; `enforce_state_through_transition`
-- refuses that in any case. So: insert the draft, address it to people, hand it
-- to `transition_plan`. The seed has done it this way since 0003.
--
-- Everything arriving here is already resolved. The presets, the default
-- deadline and the default quorum are `packages/domain`'s — `resolvePreset`,
-- `defaultDeadline`, `quorumFor` — and the Edge Function applies them before
-- calling. This function does not second-guess those numbers; it records them,
-- and the table's own constraints (a viable band, a deadline before the last
-- possible start) are what stop an impossible plan.
--
-- The short code is generated here for the reason `create_circle` generates
-- one: a collision has to be retried against the table, which only the database
-- can see.
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

create or replace function public.create_plan(
  p_circle_id uuid,
  p_title text,
  p_category text,
  p_window_start date,
  p_window_end date,
  p_daily_start_local integer,
  p_daily_end_local integer,
  p_duration_minutes integer,
  -- **Null means nobody chose.** The caller passes the organiser's number, or
  -- the circle's default, or nothing at all; what "nothing" resolves to is
  -- decided here, under the circle's lock, from the audience this plan is
  -- about to be addressed to (ADR 0026). Two reasons it is not the caller's
  -- (review round 5): a count read before the call is a count that can be
  -- stale by the time the rows are written, and this function is granted to
  -- `authenticated`, so a client calling it directly could otherwise label its
  -- own chosen number `defaulted` and have later joins overwrite it.
  p_quorum integer,
  p_response_deadline timestamptz,
  -- Absent means "the organiser alone", which is spec §5.3's default. An empty
  -- array is a different answer — nobody is required — and is kept as one.
  p_required_member_ids uuid[] default null,
  -- The days a custom plan asks about, when it has gaps (ADR 0047): sorted,
  -- distinct, and starting and ending on the window's ends. Null — every
  -- preset, and a custom range with no gap — means every day of the window,
  -- and so does a list that leaves no day out: it is stored as no rows.
  p_days date[] default null
)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  caller uuid := (select auth.uid());
  circle public.circles;
  created public.plans;
  code text;
  i integer;
  pick integer;
begin
  if caller is null then
    raise exception 'create_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'create_plan_sql', extensions.digest(caller::text, 'sha256'), 200, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  -- Locked, so that the participant list below is the roster the plan was
  -- actually addressed to rather than one that changed underneath it.
  select * into circle from public.circles c where c.id = p_circle_id for update;
  if not found then
    raise exception 'circle_not_found' using errcode = 'no_data_found';
  end if;

  if circle.status <> 'active' then
    -- An archived circle "stops all prompts" (spec §5.2), and a new plan is the
    -- loudest prompt there is.
    raise exception 'circle_archived' using errcode = 'check_violation';
  end if;

  -- The deadline's other end, checked where it is true. `plans_deadline` bounds
  -- it above and cannot bound it below: "not already past" is about now, which
  -- a check constraint may not read. The Edge Function asks the domain the same
  -- question a moment earlier, and a moment is exactly the problem — tonight's
  -- default can be the last possible start itself, so a deadline that was
  -- seconds away when the request was validated is seconds gone when the row is
  -- written, and the plan arrives with its replies already closed.
  if p_response_deadline <= now() then
    raise exception 'deadline_out_of_range' using errcode = 'P0001';
  end if;

  -- Refused rather than tidied, as the domain refuses it (`windowError`): a
  -- list out of order or not ending on the window's ends is a caller that
  -- has misunderstood which days it means.
  if planning.days_invalid(p_days, p_window_start, p_window_end) then
    raise exception 'days_invalid' using errcode = 'P0001';
  end if;

  -- The same alphabet as a circle's, and the same reason: a plan's code is read
  -- aloud and pasted into a chat (`/p/:code`), so no `o`, `l`, `i`, `0` or `1`.
  loop
    code := '';
    for i in 1..8 loop
      -- Rejection sampling: a byte is 0..255 and 256 is not a multiple of 31,
      -- so `% 31` would favour the first eight letters. Bytes from the last,
      -- partial run are thrown away and redrawn (about 3% of them).
      loop
        pick := get_byte(extensions.gen_random_bytes(1), 0);
        exit when pick < (256 / length(alphabet)) * length(alphabet);
      end loop;
      code := code || substr(alphabet, 1 + (pick % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.plans p where p.short_code = code);
  end loop;

  insert into public.plans (
    circle_id, mode, organiser_user_id, title, category, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, quorum_source, response_deadline, short_code
  )
  values (
    p_circle_id, 'named', caller, p_title, p_category, circle.time_zone,
    p_window_start, p_window_end, p_daily_start_local, p_daily_end_local,
    p_duration_minutes,
    -- The request's number, then the circle's own default, then the rule. The
    -- circle's default is read here rather than taken from the caller for the
    -- same reason the label is (review round 6): this function is granted to
    -- `authenticated`, so a direct call with no quorum must not turn a circle
    -- that *has* chosen a default into a plan that follows the audience.
    coalesce(p_quorum, circle.default_quorum, public.soft_quorum((
      select count(*)::integer from public.circle_members m
      where m.circle_id = p_circle_id and m.status = 'active'
    ))),
    case
      when p_quorum is null and circle.default_quorum is null then 'defaulted'
      else 'chosen'
    end,
    p_response_deadline, code
  )
  returning * into created;

  -- Who it was addressed to: the circle's active members at this moment. A
  -- fact, not a derivation — somebody who joins on Tuesday is not a
  -- non-responder to a question asked on Monday (0003's own comment, and
  -- spec §9 makes joining an active plan an opt-in).
  -- Rows only for a window with gaps; `enforce_plan_days` holds that at commit.
  if p_days is not null and cardinality(p_days) < (p_window_end - p_window_start) + 1 then
    insert into public.plan_days (plan_id, day)
    select created.id, d from unnest(p_days) d;
  end if;

  insert into public.plan_participants (plan_id, revision, user_id)
  select created.id, created.revision, m.user_id
  from public.circle_members m
  where m.circle_id = p_circle_id and m.status = 'active';

  -- "The organiser is required by default" (spec §5.3). An explicit list
  -- replaces that rather than adding to it: an organiser who says "these three
  -- have to be there" has said something about themselves too.
  --
  -- Refused, not filtered. A list that quietly loses the member who left while
  -- the form was open produces a plan the organiser believes needs four people
  -- and that can be confirmed with three — and nothing anywhere says so.
  -- `revise_plan` refuses the same request for the same reason.
  if exists (
    select 1 from unnest(coalesce(p_required_member_ids, array[caller])) as required
    where not exists (
      select 1 from public.circle_members m
      where m.circle_id = p_circle_id and m.user_id = required and m.status = 'active'
    )
  ) then
    raise exception 'not_a_participant' using errcode = 'P0001';
  end if;

  -- `distinct`, because a list naming somebody twice is a list naming them, and
  -- the primary key would otherwise abort the whole creation over a repeat.
  insert into public.plan_required_members (plan_id, revision, user_id)
  select distinct created.id, created.revision, required
  from unnest(coalesce(p_required_member_ids, array[caller])) as required;

  -- And out of `draft` by the only route there is. The guards — an active
  -- member with a saved place, and no plan already `collecting` or `ready` in
  -- this circle (`plan_in_progress`, ADR 0033) — run here, so an anonymous
  -- caller's plan, or a second plan beside one still finding a time, is rolled
  -- back rather than left behind. The one-open-plan rule is the machine's and
  -- not repeated above: this function holds the circle's lock from the top, so
  -- the guard's own lock is the same one, and two "Ask the group" taps arriving
  -- together are decided one after the other.
  -- Who started it, durably (SUS-177). The outbox event says the same for 30
  -- days and the client's `plan_created` for as long as the client managed to
  -- send it; this is the record the founder's organiser gate reads. Ids and the
  -- moment, in the plan's own transaction, so a plan without it cannot exist.
  -- Named plans only: who starts a quiet ask stays in `private.plan_initiators`
  -- and `create_quiet_ask` does not come through here.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, occurred_at)
  values (caller, 'plan.created', 'plan', created.id, created.created_at);

  return planning.transition_plan(created.id, 'create_named', caller);
end;
$$;

comment on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) is
  'Creates a named plan as a draft, addresses it to the circle''s active members, and moves it to collecting through the state machine, and records who created it in private.audit_log (plan.created, kept as long as the plan). Defaults are resolved by the domain before it is called.';

revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) from public;
revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) from anon, authenticated;
grant execute on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) to authenticated;

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
  pick integer;
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
      -- Rejection sampling: a byte is 0..255 and 256 is not a multiple of 31,
      -- so `% 31` would favour the first eight letters. Bytes from the last,
      -- partial run are thrown away and redrawn (about 3% of them).
      loop
        pick := get_byte(extensions.gen_random_bytes(1), 0);
        exit when pick < (256 / length(alphabet)) * length(alphabet);
      end loop;
      code := code || substr(alphabet, 1 + (pick % length(alphabet)), 1);
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

-- supabase/sql/functions/public/reissue_invite.sql
-- ---------------------------------------------------------------------------
-- The service role's way to reissue a circle's invite (SUS-125).
--
-- "The invite key has leaked" (`docs/runbooks/environments.md`): every live
-- invite secret was derived from `INVITE_LINK_KEY`, so rotating the key alone
-- only makes the links unshowable; the old ones keep opening their circles.
-- `scripts/rotate-invite-key.mjs` derives a fresh secret under the new key for
-- every circle and calls this to swap it in. `issue_invite` cannot do that: it
-- is the owner's alone and reads `auth.uid()`, and there are thousands of
-- owners and one operator.
--
-- It names the invite it replaces and does nothing, returning false, if that
-- one is no longer live (an owner reset the link while the sweep ran).
--
-- Like `issue_invite` it takes a digest and never a secret, so the database
-- learns nothing it did not know. The old link is revoked in the same
-- statement as the new one is inserted, so there is no moment with two live
-- links (`circle_invites_one_live_idx`) or none.
--
-- **Not callable by a client.** Granted to `service_role` alone; the audit row
-- has no actor, which is how a reader tells an operator's rotation from an
-- owner's. No `circles.invite_rotated` event: the owner did nothing and has
-- nothing to be told; their next look at the link shows the new one.
-- ---------------------------------------------------------------------------

create or replace function public.reissue_invite(
  p_circle_id uuid,
  p_secret_hash bytea,
  p_invite_id uuid,
  p_replaces uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  issued public.circle_invites;
  revoked integer;
begin
  select c.owner_user_id into owner from public.circles c where c.id = p_circle_id;
  if not found then
    raise exception 'circle_not_found' using errcode = 'no_data_found';
  end if;

  -- Only the invite the sweep saw. If the owner reset the link between the
  -- read and this call, the live one is already theirs and already under the
  -- new key: revoking it would kill a link they may have just shared.
  update public.circle_invites i
  set revoked_at = now()
  where i.id = p_replaces and i.circle_id = p_circle_id and i.revoked_at is null;
  get diagnostics revoked = row_count;
  if revoked = 0 then
    return false;
  end if;

  insert into public.circle_invites (id, circle_id, secret_hash, created_by)
  values (p_invite_id, p_circle_id, p_secret_hash, owner)
  returning * into issued;

  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (null, 'circles.invite_reissued', 'circle', p_circle_id,
          jsonb_build_object('invite_id', issued.id));

  return true;
end;
$$;

comment on function public.reissue_invite(uuid, bytea, uuid, uuid) is
  'Replaces a circle''s live invite with one the service role derived under a new key, revoking the old. For the "invite key has leaked" runbook; service_role only.';

revoke all on function public.reissue_invite(uuid, bytea, uuid, uuid) from public;
revoke all on function public.reissue_invite(uuid, bytea, uuid, uuid) from anon, authenticated;
grant execute on function public.reissue_invite(uuid, bytea, uuid, uuid) to service_role;

-- supabase/sql/functions/public/take_rate_token.sql
-- ---------------------------------------------------------------------------
-- One fixed window, one counter, one answer: may this happen?
--
-- The window is derived from the clock rather than stored, so there is no
-- bookkeeping to get wrong and no row to expire before it is read: every caller
-- in the same window computes the same `window_start` and lands on the same row.
--
-- **Fixed windows, on purpose (SUS-125).** A caller can spend a full allowance
-- at the end of one window and another at the start of the next, so across a
-- boundary the real ceiling is up to twice `p_limit`. That is accepted. Every
-- limit here is a volume brake, never authorisation (`_shared/rate.ts`): the
-- rules that matter are enforced in the database, and a factor of two on a
-- brake changes how fast a script is slowed, not what it can reach. A sliding
-- window costs a row per attempt, or two counters and a weighted sum, and this
-- one is a single upsert on the hot path of every join. Revisit it only if a
-- limit is ever asked to do more than slow a script down (SUS-62 owns tuning).
--
-- Counting happens whether or not the answer is yes. A refused attempt is still
-- an attempt, and a limiter that only counts successes is one that can be held
-- open indefinitely by failing.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.
-- ---------------------------------------------------------------------------

create or replace function public.take_rate_token(
  p_scope text,
  p_key_hash bytea,
  p_limit integer,
  p_window interval,
  -- What this attempt costs. One for a request; more for a request that carries
  -- many of whatever is being limited — a batch of fifty analytics events is
  -- fifty events, and charging it as one made "six hundred a minute" mean
  -- thirty thousand.
  p_cost integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  seconds double precision := extract(epoch from p_window);
  bucket_start timestamptz;
  taken integer;
begin
  if p_limit < 1 or seconds <= 0 or p_cost < 1 then
    raise exception 'take_rate_token needs a positive limit, window and cost'
      using errcode = 'invalid_parameter_value';
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / seconds) * seconds);

  insert into jobs.rate_counters (scope, key_hash, window_start, count)
  values (p_scope, p_key_hash, bucket_start, p_cost)
  on conflict (scope, key_hash, window_start)
    do update set count = jobs.rate_counters.count + p_cost
  returning count into taken;

  return taken <= p_limit;
end;
$$;

comment on function public.take_rate_token(text, bytea, integer, interval, integer) is
  'Counts an attempt in the current fixed window and says whether it is within the limit — `p_cost` for a request that carries many of whatever is limited. Counts refusals too.';

revoke all on function public.take_rate_token(text, bytea, integer, interval, integer) from public;
revoke all on function public.take_rate_token(text, bytea, integer, interval, integer) from anon, authenticated;
grant execute on function public.take_rate_token(text, bytea, integer, interval, integer) to service_role;

-- END GENERATED: function definitions
