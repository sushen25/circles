-- 0057_limits_hold_when_sql_is_called_directly
--
-- (Numbered 0057, not the 0054 or 0055 `pnpm gen:migration` suggests: two open
-- pull requests take 0055 and 0056.)
--
-- The Edge Functions limit how often a person may do things, and the SQL under
-- them is callable over /rest/v1/rpc/ by anybody signed in, anonymous included,
-- without meeting any of it. This adds the limits that hold either way:
--
--   * `take_rate_token` inside the client-callable functions (the generated
--     block below), keyed on the caller and, for the plan functions, on the
--     caller's own plan, and far above the Edge limits so those stay the ones a
--     person meets;
--   * a length limit on `plans.cancel_note`, which was the one note with none;
--   * limits on what `create_circle` stores, which a direct call could fill with
--     a line break that then reaches an email subject, or with megabytes;
--   * one verification letter per address an hour, applied silently in
--     `request_email_updates`.

-- Every other note on a plan is capped at 280. `cancel_note` is read by every
-- member and printed in every cancellation letter.
alter table public.plans
  add constraint plans_cancel_note_length check (char_length(cancel_note) <= 280);

-- `not valid`: enforced for every new or changed row, without re-reading the
-- rows already there. The Edge schema has always normalised these, so no
-- honest row breaks them, but a migration should not be what finds the one that
-- does.
alter table public.circles
  add constraint circles_name_single_line check (name !~ '[[:cntrl:]]') not valid,
  add constraint circles_color_length check (char_length(color) <= 24) not valid,
  add constraint circles_creation_key_length check (char_length(creation_key) <= 64) not valid;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/cancel_plan.sql
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

-- supabase/sql/functions/public/confirm_meetup.sql
-- ---------------------------------------------------------------------------
-- Locking a time in.
--
-- A wrapper over `planning.transition_plan(plan, 'confirm', …)`, which already
-- does all of the work: the organiser guard, the eligibility check, the frozen
-- confirmation row, the derived attendance and the event, in one transaction.
-- The wrapper exists for the reasons `cancel_plan`'s does — `planning` is not
-- reachable by a client, and the actor must be `auth.uid()` rather than an
-- argument — and for one of its own, which is the whole of the code below the
-- lock.
--
-- **Telling a stale screen from a wrong choice.** `candidate_is_eligible`
-- answers one boolean for four different situations: the set is for an older
-- revision, it was computed before somebody's answer, it came from a different
-- engine, or the id is simply not one of the times on offer. `transition_plan`
-- turns all four into `needs_candidate` — and the first three mean "your screen
-- is out of date, fetch it again", while the last means "that is not one of the
-- options". A client that cannot tell them apart either refetches when it need
-- not or, worse, shows "that time is gone" to an organiser whose screen was
-- right a second ago.
--
-- So the staleness is compared here, ahead of the guard, and raised as
-- `stale_candidates`. What reaches `needs_candidate` afterwards is then true:
-- the set is current and the id is not in it.
--
-- And "current" is measured against the set the *organiser* was shown, whose id
-- they send, rather than against whatever is current by the time the tap
-- arrives. An answer landing while the review screen is open recalculates
-- inline (ADR 0018): there is a new current set, the chosen time may still be
-- eligible in it, and confirming would freeze an availability list nobody
-- looked at.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_meetup(
  p_plan_id uuid,
  -- The ISO start of the chosen candidate. A candidate's identity is its time
  -- (`candidateIdOf`), because the set is recomputed whenever anybody answers.
  p_candidate_id text,
  -- **The candidate set the organiser was looking at**, by its id. Not optional:
  -- "load the current candidate set and check the candidate belongs to it"
  -- (architecture §9.1) is a question about *which* set was on the screen, and a
  -- caller who cannot say has not made the check — they have skipped it.
  --
  -- The id rather than a version token, which an earlier draft used. A set is
  -- replaced when the revision moves, when an answer moves the input version,
  -- *and* when the engine's scoring version changes — and that last one leaves
  -- `<revision>.<input_version>` identical, so a token made of those two
  -- accepted a set the organiser had never seen. The id is the one thing that
  -- changes whenever the set does.
  p_expected_set_id uuid,
  -- "Did you have to chase anyone outside the app?" (spec §5.10). Optional for
  -- the organiser: the review screen never holds "Lock it in" for it (SUS-194),
  -- and null is stored as "not answered". It stays a parameter with no default,
  -- ahead of the optional details (a parameter with no default cannot follow one
  -- that has it), so a caller passes null rather than leaving it out. Anything
  -- else than `none | one | more` is refused, whichever door it came through.
  p_chased_answer text,
  p_place_name text default null,
  p_place_url text default null,
  p_note text default null
)
returns public.meetup_confirmations
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  confirmation public.meetup_confirmations;
begin
  if caller is null then
    raise exception 'confirm_meetup requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'confirm_meetup_sql', extensions.digest(caller::text, 'sha256'), 60, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;
  if not public.take_rate_token(
    'confirm_meetup_sql_plan', extensions.digest(caller::text || ':' || p_plan_id::text, 'sha256'), 20, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  -- Membership before anything else that can be observed. This function is
  -- `security definer` and callable by anybody signed in, so every refusal after
  -- this point is an answer about a plan — that it exists, which version it is
  -- at, whether its set is current. "Only active members see or act on it"
  -- (AGENTS.md) is structural, and a refusal is a way of seeing.
  --
  -- A non-member gets the same answer as a plan that is not there, deliberately:
  -- telling them apart would confirm the id.
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- A member may know their plan has an organiser who is not them. The cheap,
  -- early one; `transition_plan`'s guard is the one that counts, and it also
  -- re-checks membership.
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if p_chased_answer is not null and p_chased_answer not in ('none', 'one', 'more') then
    raise exception 'chased_answer_required' using errcode = 'P0001';
  end if;

  -- **The set the organiser was looking at**, not merely a set that is current.
  --
  -- Asking "is there a current set?" was not the freshness check it looked
  -- like. An answer landing while the review screen is open recalculates
  -- inline (ADR 0018), so by the time the organiser taps there is a *new*
  -- current set — and if the time they chose is still eligible in it, the
  -- confirmation freezes an availability list they never saw. Somebody who
  -- withdrew appears on the card; somebody who just answered does not.
  --
  -- So the caller says which set they were shown, and it is compared here,
  -- under the lock, against the one that is current for the plan. One
  -- comparison covers every way a set can be replaced — a new revision, a new
  -- answer, a new engine — and covers the case where the plan has moved to a
  -- version whose recalculation has not landed, because then there is no
  -- current set and nothing to match.
  -- Null first and on its own: a caller who names no set was not looking at
  -- one, and `null is distinct from null` is false — so a plan whose
  -- recalculation has not landed would have matched a request that named
  -- nothing, and the check would have passed by both sides being absent.
  if p_expected_set_id is null then
    raise exception 'stale_candidates' using errcode = 'P0001';
  end if;

  if p_expected_set_id is distinct from (
    select cs.id from public.candidate_sets cs
    where cs.plan_id = plan.id
      and cs.revision = plan.revision
      and cs.input_version = plan.input_version
      and cs.scoring_version = plan.scoring_version
  ) then
    raise exception 'stale_candidates' using errcode = 'P0001';
  end if;

  -- And the rest is the machine's. The organiser guard, `candidate_is_eligible`
  -- against the set, the passed-time check, the frozen row, the attendance and
  -- `confirmation.meetup_confirmed` all happen in there, where the plan row is
  -- already locked by the statement above.
  perform planning.transition_plan(
    p_plan_id,
    'confirm',
    caller,
    jsonb_strip_nulls(jsonb_build_object(
      'candidate_id', p_candidate_id,
      'place_name', p_place_name,
      'place_url', p_place_url,
      'note', p_note,
      'chased_answer', p_chased_answer
    ))
  );

  select * into confirmation
  from public.meetup_confirmations c
  where c.plan_id = plan.id and c.revision = plan.revision and c.status = 'active';

  return confirmation;
end;
$$;

comment on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) is
  'Locks in a candidate as the calling organiser, through planning.transition_plan, and distinguishes a stale candidate set from a candidate that is not on offer.';

revoke all on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) from public;
revoke all on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) from anon, authenticated;
grant execute on function public.confirm_meetup(uuid, text, uuid, text, text, text, text) to authenticated;

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
      code := code || substr(
        alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)),
        1
      );
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

-- supabase/sql/functions/public/issue_invite.sql
-- ---------------------------------------------------------------------------
-- The circle's one live invite link.
--
-- "The owner shares one revocable circle link" and "can remove a member and
-- reset the link without disturbing existing members" (spec §5.2). Issuing and
-- resetting are the same operation — a new secret, and every earlier one dead —
-- so they are one function. `create-circle` calls it for the first link; the
-- reset endpoint (S1-23) will call it for every later one.
--
-- **The secret never arrives.** The Edge Function generates 32 random bytes,
-- hashes them, and passes the digest; the readable form goes back to the client
-- once, in the response, to build `/join#<secret>`. §14: the secret lives in the
-- URL fragment, which no server sees, and only its SHA-256 is stored.
--
-- Revoking first, in the same statement, is what makes "reset" mean something:
-- two live invites would be two capabilities, and rotating would stop
-- invalidating anything.
--
-- **The invite's id may come from the caller** (ADR 0028). The Edge Functions
-- derive the secret from the id with a key only they hold, so that the owner
-- can be shown the link again (`get-invite-link`) while the database still
-- stores nothing but a digest. That needs the id before the row exists. An id
-- the caller chooses buys them nothing: the secret is the key's to derive, and
-- a digest of anything else is simply a link `get-invite-link` cannot show.
-- ---------------------------------------------------------------------------

create or replace function public.issue_invite(
  p_circle_id uuid,
  p_secret_hash bytea,
  p_invite_id uuid default null
)
returns public.circle_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  issued public.circle_invites;
  revoked integer;
begin
  if caller is null then
    raise exception 'issue_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'issue_invite_sql', extensions.digest(caller::text, 'sha256'), 120, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  -- The owner's, not any member's. Handing out the way in is the one circle
  -- decision spec §5.2 gives to the owner alone.
  if not exists (
    select 1 from public.circles c where c.id = p_circle_id and c.owner_user_id = caller
  ) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  update public.circle_invites i
  set revoked_at = now()
  where i.circle_id = p_circle_id and i.revoked_at is null;
  get diagnostics revoked = row_count;

  insert into public.circle_invites (id, circle_id, secret_hash, created_by)
  values (coalesce(p_invite_id, gen_random_uuid()), p_circle_id, p_secret_hash, caller)
  returning * into issued;

  -- Rotation is a fact the owner may need to explain later ("the old link
  -- stopped working on Tuesday"), and the count of how often links leak is
  -- worth having. Ids only.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.invite_issued', 'circle', p_circle_id,
          jsonb_build_object('invite_id', issued.id));

  -- Only when something was actually revoked. The first link a circle has is
  -- part of the circle being created, and `circles.circle_created` already says
  -- that; `circles.invite_rotated` means "the one you were given has stopped
  -- working", which is a thing to tell people and is not true here.
  if revoked > 0 then
    perform jobs.emit('circles.invite_rotated', 'circle', p_circle_id,
      jsonb_build_object('circle_id', p_circle_id));
  end if;

  return issued;
end;
$$;

comment on function public.issue_invite(uuid, bytea, uuid) is
  'Issues the circle''s invite from a digest of a secret the server never sees, revoking any earlier one. The owner''s alone; resetting the link is the same call (spec §5.2).';

revoke all on function public.issue_invite(uuid, bytea, uuid) from public;
revoke all on function public.issue_invite(uuid, bytea, uuid) from anon, authenticated;
grant execute on function public.issue_invite(uuid, bytea, uuid) to authenticated;

-- supabase/sql/functions/public/redeem_invite.sql
-- ---------------------------------------------------------------------------
-- redeem_invite
--
-- The only way a membership is created from an invite link (§9.1). A definer
-- function rather than an insert policy, for the reason `create_circle` is
-- one: joining is several writes that have to be one — the membership, the use
-- count, and two checks that are only true if nobody else joins between them.
--
-- **The secret never arrives here.** The Edge Function hashes the link
-- fragment with SHA-256 and passes the digest, so the capability itself is
-- never a statement parameter and cannot reach a query log (§14: tokens are
-- "never logged"). The digest finds the invite; the row it finds is the
-- authority.
--
-- What this function enforces cannot be bypassed by calling it directly: the
-- invite must be live, the cap holds, the name must be free, and the membership
-- lands on `auth.uid()` rather than on anything the caller says. Turnstile and
-- the per-IP limit live in the Edge Function because they are abuse controls
-- rather than authorisation — skipping them lets somebody make more requests,
-- not make a request the database would have refused.
--
-- Idempotent by its own state rather than by a key column: being an active
-- member of the circle *is* the record that this already happened, so a retry
-- returns the circle and writes nothing. (`create_circle` carries a
-- `creation_key` because a circle has no such natural record — asking twice
-- would leave two circles and no way to tell which link was shared.)
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(
  p_secret_hash bytea,
  p_display_name text
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  invite public.circle_invites;
  target public.circles;
begin
  if caller is null then
    raise exception 'redeem_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'redeem_invite_sql', extensions.digest(caller::text, 'sha256'), 120, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  -- `invite_inactive` is one error for three causes — no such secret, revoked,
  -- or a circle that has since gone — because the caller is not entitled to
  -- know which. The LinkInvalid screen says the same thing to all three.
  select * into invite
  from public.circle_invites i
  where i.secret_hash = p_secret_hash and i.revoked_at is null;

  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- Serialises concurrent joins. `enforce_member_cap` takes the same lock, and
  -- taking it here too means the duplicate-name check and the cap see one
  -- roster rather than two.
  select * into target from public.circles c where c.id = invite.circle_id for update;
  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- The cap, the name and rejoining after removal are the same for every way
  -- into a circle, and live in `private.admit_member` so that they stay the
  -- same (ADR 0022 added a second way in). What is this function's own is the
  -- invite, and counting its use — once, and not for somebody who was already
  -- in: a retry, a second tap, or the link opened twice in one browser.
  if private.admit_member(target.id, caller, p_display_name) then
    update public.circle_invites i
    set use_count = i.use_count + 1
    where i.id = invite.id;
  end if;

  return target;
end;
$$;

comment on function public.redeem_invite(bytea, text) is
  'Joins the caller to the circle behind an invite digest. Idempotent on an existing active membership; raises invite_inactive, duplicate_name or circle_full.';

revoke all on function public.redeem_invite(bytea, text) from public;
revoke all on function public.redeem_invite(bytea, text) from anon, authenticated;
grant execute on function public.redeem_invite(bytea, text) to authenticated;

-- supabase/sql/functions/public/replace_response.sql
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

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'replace_response_sql', extensions.digest(caller::text, 'sha256'), 600, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;
  if not public.take_rate_token(
    'replace_response_sql_plan', extensions.digest(caller::text || ':' || p_plan_id::text, 'sha256'), 300, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
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

-- supabase/sql/functions/public/request_email_updates.sql
-- ---------------------------------------------------------------------------
-- "Email me about this meetup."
--
-- Three writes that have to happen together or not at all: the contact, the
-- consent, and the job that sends the verification email. A contact with no job
-- is an address stored for nothing; a job with no subscription would send an
-- email nobody asked for.
--
-- **The token is not one of them.** It is minted when the email is sent, by
-- whoever sends it (ADR 0020) — a token minted here has no way of reaching the
-- letter: `jobs.notification_jobs` carries ids and no payload, the outbox
-- refuses any key named `token`, and the row in `email_action_tokens` holds
-- only a digest. An earlier draft took `p_token_hash`, wrote the row, and threw
-- the readable half away in the Edge Function, which made every verification
-- link unsendable and every token row expire unused.
--
-- **One address can belong to two identities.** Uniqueness has been
-- `(email_hash, user_id)` since 0009 — "two guest memberships may each be
-- reachable at the same address (spec §9)" — so this inserts *this person's*
-- contact for the address and says nothing about anybody else's. An earlier
-- draft read the address back by hash alone and refused when the row belonged
-- to somebody else, which turned the commonest real case into a permanent
-- silence: a guest who loses their session, rejoins as a new identity and asks
-- again was told "check your email" and never heard anything.
--
-- **Suppression is not looked up here.** `apply_suppression` gives a new
-- contact for a tombstoned address the status `suppressed` on insert, and
-- `record_suppression` carries a suppression across every contact holding that
-- address. So the honest thing is to insert and read the status back, which is
-- what the note from S1-11 says: "never write `status = 'pending'` over it".
--
-- **It answers the same way whatever happened, to everyone but the address's
-- own confirmed owner.** Suppressed, already verified, or new: `sent` says
-- whether an email was enqueued and nothing else, and the endpoint above turns
-- all of them into "check your email". Four different answers would let a
-- member walk a list of addresses through a plan and learn which of their
-- friends use the product.
--
-- **The one exception is the owner (SUS-164, ADR 0055).** When the address asked
-- about is the caller's own confirmed sign-in address (the same test that
-- promotes their contact below: `email_confirmed_at` set, not anonymous, the
-- same normalised address), the answer also carries `delivery`: `live` (emails
-- will arrive), `pending` (a link was sent) or `suppressed` (nothing will ever
-- be sent to it). They proved the address with a code, so telling them the
-- truth about their own address leaks nothing, and promising email to an
-- address that bounced is the one thing worse than telling them. For every
-- other caller the key is absent, and the jsonb is exactly what it was.
-- ---------------------------------------------------------------------------

create or replace function public.request_email_updates(
  p_plan_id uuid,
  p_user_id uuid,
  -- Already trimmed, lower-cased and NFC-normalised by the request schema; the
  -- column's own check refuses anything else, so the two agree.
  p_email text,
  p_consent_version text,
  -- The request this is, which is what architecture §13 calls the occurrence
  -- for `verify_email`: a retry never reaches this function (the idempotency
  -- claim answers it), and a genuine resend is a new request and so a new
  -- email. Not a token id any more, because there is no token here to name.
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  contact private.email_contacts;
  subscription private.email_subscriptions;
  -- The address asked about is the caller's own confirmed sign-in address.
  own boolean;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- A member of the plan's circle, asked of the person the Edge Function
  -- identified rather than of `auth.uid()`: this runs as the service role, so
  -- there is no caller for the database to ask about. The same answer for "no
  -- such plan" and "not your circle", which is what every other read of a plan
  -- does.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  -- Nothing to subscribe to. "Verification after the plan completed or was
  -- cancelled: no stale mail is sent" (spec §9) is the same sentence one step
  -- earlier: asking for email about a meetup that is over would enqueue a
  -- verification message about something that has already happened.
  if plan.state in ('completed', 'cancelled', 'expired') then
    raise exception 'plan_is_finished' using errcode = 'P0001';
  end if;

  -- **A confirmed sign-in address is proof for this person's own contact**
  -- (ADR 0027, ADR 0050). A verification link and `auth.users.email_confirmed_at`
  -- are two ways of obtaining the same proof: the code the person typed back
  -- came to this address. So when the address asked for is the caller's own
  -- confirmed one, their contact for it is created or promoted `verified` first
  -- (`dispatch_organiser_contact`, which touches only `p_user_id`'s row and
  -- leaves a suppressed one suppressed), and the "verified contact, no link"
  -- branch below makes the subscription live with nothing sent. Any other
  -- address, a guest, or an address auth has not confirmed takes the link path
  -- exactly as before: nothing here lets one person vouch for another's contact.
  select exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false)
      and lower(btrim(u.email)) = p_email
  ) into own;

  if own then
    perform public.dispatch_organiser_contact(p_user_id);
  end if;

  -- This person's contact for this address. The insert is where suppression is
  -- decided: `apply_suppression` stamps a tombstoned address as `suppressed`
  -- before the row lands, and an existing row keeps whatever status it has.
  insert into private.email_contacts (user_id, email_normalized)
  values (p_user_id, p_email)
  on conflict (email_hash, user_id) do update set updated_at = now()
  returning * into contact;

  if contact.status = 'suppressed' then
    -- Nothing more is written and nothing is sent. The person asking may not be
    -- the person who suppressed it, and spec §9's "no automatic reactivation"
    -- is the address owner's decision rather than theirs.
    return case when own
      then jsonb_build_object('sent', false, 'delivery', 'suppressed')
      else jsonb_build_object('sent', false) end;
  end if;

  -- The consent, recorded now with the words it was given for, because now is
  -- when it was given. The subscription is `active` from this moment and the
  -- *contact* is what is unverified: `private.email_recipients_for` sends to a
  -- verified contact with an active subscription and an active membership, and
  -- to nobody else, so an address somebody typed wrong receives nothing while
  -- the row honestly says what was agreed and when (ADR 0019).
  --
  -- Asking again after stopping starts it again — a fresh consent from the
  -- person who owns the address, which is a different thing from the automatic
  -- reactivation of a *suppressed* address that spec §9 forbids.
  insert into private.email_subscriptions (
    contact_id, user_id, scope, plan_id, status, consent_text_version
  )
  values (contact.id, p_user_id, 'plan_updates', p_plan_id, 'active', p_consent_version)
  on conflict (contact_id, scope, plan_id) do update
    set status = 'active',
        withdrawn_at = null,
        consent_text_version = excluded.consent_text_version,
        updated_at = now()
  returning * into subscription;

  perform jobs.emit('communication.subscription_changed', 'subscription', subscription.id,
    jsonb_build_object(
      'subscription_id', subscription.id,
      'contact_id', contact.id,
      'plan_id', p_plan_id,
      'status', subscription.status
    ));

  -- A verified address needs no second verification: the subscription above is
  -- already live, and another link would be an email nobody asked for.
  if contact.status = 'verified' then
    -- The current state, once, for somebody who subscribes after a time was
    -- decided: `verify_email_contact` does this for a late verification, and
    -- this is the other way in (a confirmed sign-in address, or a contact
    -- verified earlier). The key is the dispatcher's own `locked_in` key for
    -- this recipient and this confirmation, so a letter they already had is
    -- not sent twice.
    insert into jobs.notification_jobs (
      channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
    )
    select 'email', 'locked_in', contact.id, p_plan_id, mc.revision, now(),
      jobs.idempotency_key(
        'email', contact.id::text, p_plan_id::text, mc.revision::text,
        'locked_in', mc.id::text)
    from public.meetup_confirmations mc
    where mc.plan_id = p_plan_id and mc.status = 'active'
    on conflict (idempotency_key) do nothing;

    return case when own
      then jsonb_build_object('sent', false, 'delivery', 'live')
      else jsonb_build_object('sent', false) end;
  end if;

  -- **At most one verification letter per address an hour, said to nobody.**
  -- The Edge Function's counters are per person and per connection, so a
  -- member who controls several of either can still have the same stranger's
  -- address mailed again and again, and each letter spends the sending domain's
  -- reputation. This bound is on the address, and it is keyed on the address's
  -- hash alone for that reason; it counts the other identities' requests too.
  --
  -- It is applied **silently**. Whatever happens here, the answer below is the
  -- one the first request got, so a second request does not learn that the
  -- first one (somebody else's, perhaps) already went out: an answer that
  -- differed would be an oracle for whether an address was just asked about.
  -- The consent above is still recorded, and the person still gets "check your
  -- email"; the letter that is already on its way is the one that was sent.
  --
  -- The price is that somebody who names a stranger's address can use up that
  -- address's hour, and the owner's own request inside it sends nothing. The
  -- owner's confirmed sign-in address never gets here (it is verified above),
  -- and the next hour starts clean.
  if not public.take_rate_token(
    'verify_letter_address', contact.email_hash, 1, interval '1 hour'
  ) then
    return case when own
      then jsonb_build_object('sent', true, 'delivery', 'pending')
      else jsonb_build_object('sent', true) end;
  end if;

  insert into jobs.notification_jobs (
    channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key
  )
  values (
    'email', 'verify_email', contact.id, p_plan_id, plan.revision, now(),
    -- Architecture §13's key, composed the one way (`jobs.idempotency_key`).
    -- The dispatcher will mint the token for this job when it sends it and
    -- spend whatever came before (`public.issue_verification_token`), which is
    -- where "resend invalidates the previous token" (spec §5.8) now lives:
    -- one job, one letter, one live link.
    jobs.idempotency_key(
      'email', contact.id::text, p_plan_id::text, plan.revision::text,
      'verify_email', p_request_id)
  )
  -- Belt and braces behind the idempotency claim in the Edge Function, which is
  -- what actually answers a retry: the same request id twice is the same key,
  -- and the second insert is the no-op it should be.
  on conflict (idempotency_key) do nothing;

  return case when own
    then jsonb_build_object('sent', true, 'delivery', 'pending')
    else jsonb_build_object('sent', true) end;
end;
$$;

comment on function public.request_email_updates(uuid, uuid, text, text, text) is
  'Records consent to plan-update email for one plan and enqueues the verification email; the token is minted by the sender (ADR 0020). One address may belong to two identities; suppression is decided by the insert trigger. Answers the same way whatever happened, except that the address''s own confirmed owner also gets `delivery` (live, pending or suppressed). Service role only.';

revoke all on function public.request_email_updates(uuid, uuid, text, text, text) from public;
revoke all on function public.request_email_updates(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function public.request_email_updates(uuid, uuid, text, text, text) to service_role;

-- supabase/sql/functions/public/revise_plan.sql
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
  p_expected_version text default null,
  -- The days the plan should ask about, sorted and distinct, first and last
  -- the window's ends (ADR 0047). Null leaves them alone — unless the window's
  -- ends move, when the plan asks about every day of the new window: that is
  -- what "Try a wider window" sends, and it drops the gaps on purpose.
  p_days date[] default null
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
  new_start date;
  new_end date;
  old_days date[];
  new_days date[];
  days_changed boolean;
  reasks boolean;
begin
  if caller is null then
    raise exception 'revise_plan requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'revise_plan_sql', extensions.digest(caller::text, 'sha256'), 60, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;
  if not public.take_rate_token(
    'revise_plan_sql_plan', extensions.digest(caller::text || ':' || p_plan_id::text, 'sha256'), 20, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
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

  -- The days (ADR 0047), as the plan asks about them now and as it would.
  -- No rows in `plan_days` is every day of the window, so both sides are
  -- spelled out as lists and compared as lists, whatever form each is stored in.
  new_start := coalesce((p_payload ->> 'window_start')::date, plan.window_start);
  new_end := coalesce((p_payload ->> 'window_end')::date, plan.window_end);
  if planning.days_invalid(p_days, new_start, new_end) then
    raise exception 'days_invalid' using errcode = 'P0001';
  end if;

  old_days := coalesce(
    (select array_agg(d.day order by d.day) from public.plan_days d where d.plan_id = plan.id),
    (select array_agg(g::date order by g)
     from generate_series(plan.window_start, plan.window_end, interval '1 day') g)
  );
  new_days := case
    when p_days is not null then p_days
    when new_start = plan.window_start and new_end = plan.window_end then old_days
    else (select array_agg(g::date order by g)
          from generate_series(new_start, new_end, interval '1 day') g)
  end;
  days_changed := new_days is distinct from old_days;

  if p_payload = '{}'::jsonb and p_required_member_ids is null and not p_reopen
    and not days_changed
  then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;

  -- Whether the change to the days is a new question. Adding a day is: nobody
  -- has said anything about it. Taking away a day somebody picked is: their
  -- answer no longer means what they said. Taking away days that nobody
  -- picked is not — every answer still stands as given — and the founder
  -- chose that it should not cost anybody a reply (ADR 0047). Decided here,
  -- under the lock, from `picked_days`, the same question the preview asked.
  reasks := days_changed and (
    exists (select 1 from unnest(new_days) d where d <> all (old_days))
    or exists (
      select 1 from unnest(old_days) d
      where d <> all (new_days)
        and d in (select pd from public.picked_days(p_plan_id) pd)
    )
  );

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
  --
  -- The days are judged by what they cost rather than by which keys moved: a
  -- window whose last day went, unpicked, is a `narrow` although `window_end`
  -- changed, and a gap filled in the middle is an `edit` although neither end
  -- did.
  action := case
    when p_reopen then 'reopen'
    when p_payload ?| array['daily_start_local', 'daily_end_local', 'duration_minutes'] then 'edit'
    when reasks then 'edit'
    when days_changed then 'narrow'
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

  -- The days, written in their one form: rows only when there are gaps. After
  -- the transition, so a new revision and its days arrive together; the
  -- deferred `enforce_plan_days` checks the pair at commit.
  if days_changed then
    delete from public.plan_days d where d.plan_id = revised.id;
    if cardinality(new_days) < (new_end - new_start) + 1 then
      insert into public.plan_days (plan_id, day)
      select revised.id, d from unnest(new_days) d;
    end if;
  end if;

  -- A narrowing keeps every answer, and changes what the engine is given, so
  -- the set is recomputed as it is after a quorum change. The set can change:
  -- an "I'm easy" answer counts on every day, so a candidate can sit on a day
  -- nobody picked, and taking that day away takes the candidate with it. The
  -- organiser chose that; nobody's answer changed.
  if action = 'narrow' then
    update public.plans p
    set input_version = p.input_version + 1
    where p.id = revised.id
    returning * into revised;
  end if;

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
  if revised.state = 'ready'
    and (p_payload ? 'quorum' or p_required_member_ids is not null or action = 'narrow')
  then
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
    'version', plan.revision || '.' || plan.input_version,
    -- Which of the four this was, so the handler reports what the database
    -- decided rather than what it guessed: a `narrow` asks nobody again.
    'action', action
  );
end;
$$;

comment on function public.revise_plan(uuid, boolean, jsonb, uuid[], text, date[]) is
  'Edits a plan, or reopens a confirmed one, as the calling organiser. Returns the revised plan and the audience it had before the change, derived under the same lock. A fixed set of actions over planning.transition_plan, which no client can call.';

revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[], text, date[]) from public;
revoke all on function public.revise_plan(uuid, boolean, jsonb, uuid[], text, date[]) from anon, authenticated;
grant execute on function public.revise_plan(uuid, boolean, jsonb, uuid[], text, date[]) to authenticated;

-- END GENERATED: function definitions
