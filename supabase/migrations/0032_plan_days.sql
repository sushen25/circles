-- ---------------------------------------------------------------------------
-- 0032 — A plan can ask about days with gaps between them (SUS-133, ADR 00ZZ).
--
-- The custom picker picks specific days now, by tap or by dragging across
-- them, so a plan is no longer always "every day from `window_start` to
-- `window_end`". The days a plan asks about are rows in `public.plan_days`,
-- **only when there are gaps**: no rows means every day of the window. That
-- is every preset and every plan already stored, so nothing is backfilled and
-- nothing about them changes. `window_start` and `window_end` stay the first
-- and last day asked about, so the last possible start, the thirty-day check
-- (a span, ADR 0030), retention and the analytics views read what they read.
--
--   * `public.plan_days` — the days, readable by the plan's circle, written
--     only by `create_plan` and `revise_plan`; `enforce_plan_days` holds them
--     to the window at commit.
--   * `create_plan` and `revise_plan` take `p_days` (dropped and recreated,
--     because a new argument is a new signature).
--   * `revise_plan` decides what a change to the days costs: taking away days
--     nobody picked is a `narrow` — a new transition that keeps the revision
--     and every answer — and anything else is an `edit`, a new question
--     (ADR 0017). `public.picked_days` is the fact it decides from, and the
--     preview asks the same function.
--   * `engine_input` and `dispatch_context` carry the days;
--     `enforce_window_shape` refuses a window on a day not asked about.
-- ---------------------------------------------------------------------------

create table public.plan_days (
  plan_id uuid not null references public.plans (id) on delete cascade,
  day date not null,
  primary key (plan_id, day)
);

comment on table public.plan_days is
  'The days a plan asks about, only when its window has gaps; no rows means every day from window_start to window_end (ADR 00ZZ).';

alter table public.plan_days enable row level security;

-- Who may see a plan may see which days it asks about: they are the plan.
create policy plan_days_select_member on public.plan_days
  for select to authenticated
  using (exists (
    select 1 from public.plans p where p.id = plan_id and public.auth_is_member(p.circle_id)
  ));

-- Read by the circle; written by the two definer functions alone, like the
-- plan's own window.
revoke all on public.plan_days from anon, authenticated, service_role;
grant select on public.plan_days to authenticated, service_role;

-- A new argument is a new signature, and `create or replace` would leave the
-- old one beside it, making every existing call ambiguous (0019's lesson).
drop function if exists public.create_plan(
  uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[]
);
drop function if exists public.revise_plan(uuid, boolean, jsonb, uuid[], text);

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
  ('collecting', 'narrow', 'collecting', array['organiser'], false),
  ('collecting', 'quorum_follows', 'collecting', array[]::text[], false),
  ('collecting', 'expire', 'expired', array[]::text[], false),
  ('collecting', 'cancel', 'cancelled', array['organiser_or_owner'], false),
  ('ready', 'candidates_gone', 'collecting', array[]::text[], false),
  ('ready', 'edit', 'collecting', array['organiser'], true),
  ('ready', 'adjust', 'ready', array['organiser'], false),
  ('ready', 'narrow', 'ready', array['organiser'], false),
  ('ready', 'quorum_follows', 'ready', array[]::text[], false),
  ('ready', 'confirm', 'confirmed', array['organiser','candidate'], false),
  ('collecting', 'hand_off', 'collecting', array['organiser','hand_off_target'], false),
  ('ready', 'hand_off', 'ready', array['organiser','hand_off_target'], false),
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
    -- Days taken away that nobody picked (ADR 00ZZ): the window's ends may
    -- move inward, and the two keys an adjustment takes may ride along. Never
    -- the band or the duration, which are always a new question.
    -- `revise_plan` derives it; no caller names it.
    when action = 'narrow' then array['window_start', 'window_end', 'quorum', 'response_deadline']
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
    -- Who takes the plan over, and nothing else: a hand-off changes who
    -- decides, not what is being decided (S2-05).
    when action = 'hand_off' then array['organiser_user_id']
    when action = 'confirm' then array['candidate_id', 'place_name', 'place_url', 'note', 'chased_answer']
    else array[]::text[]
  end;
$$;

revoke all on function planning.allowed_keys(text) from public;
revoke all on function planning.allowed_keys(text) from anon, authenticated;

-- supabase/sql/functions/planning/event_for.sql
-- The transition → event map. Immutable and total over `planning.transitions`;
-- `075_outbox_events.sql` walks that table and fails if a row maps to null,
-- so a transition added by the generator cannot arrive silent.

create or replace function planning.event_for(p_from_state text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'create_named' then 'planning.plan_created'
    when 'create_quiet' then 'planning.quiet_ask_created'
    when 'threshold_reached' then 'planning.threshold_reached'
    when 'expire' then 'planning.plan_expired'
    when 'accept_organiser' then 'planning.organiser_accepted'
    -- Not `organiser_accepted`: nobody accepted anything. The organiser gave
    -- the plan to somebody, and the drain tells the new one it is theirs.
    when 'hand_off' then 'planning.organiser_changed'
    when 'edit' then 'planning.plan_revised'
    -- The same event. What the circle is told is "the plan changed"; that this
    -- change cost nobody a second reply is the *absence* of a re-ask, which the
    -- notification rules read from the revision rather than from the name.
    when 'adjust' then 'planning.plan_revised'
    -- And a narrowing (ADR 00ZZ): the plan's days changed, nobody's answer did.
    when 'narrow' then 'planning.plan_revised'
    when 'candidates_ready' then 'scheduling.candidates_generated'
    -- `candidates_gone` is the engine's bookkeeping: an answer moved, the set
    -- is stale, a recalculation follows. It says nothing about whether options
    -- exist, so it announces nothing — `scheduling.no_eligible_candidates` is
    -- the recalculation's to emit, from what it actually found (S1-16).
    when 'candidates_gone' then null
    -- Nor is a quorum that followed the circle (ADR 0026). `adjust` is an
    -- organiser changing the plan, which the circle is told about; this is the
    -- plan's own default keeping up with a join that was announced already
    -- (`identity.member_joined`). Announcing it too would tell six people "the
    -- plan changed" every time a seventh tapped the link.
    when 'quorum_follows' then null
    when 'confirm' then 'confirmation.meetup_confirmed'
    when 'reopen' then 'confirmation.meetup_rescheduled'
    when 'report_outcome' then 'confirmation.outcome_reported'
    -- Cancelling a confirmed meetup is a different message from withdrawing
    -- an ask: "Thursday is off" goes to everyone who had it in a calendar.
    --
    -- And withdrawing a quiet ask before threshold is not a message at all:
    -- "closed privately, nobody told" (spec §9). The circle was never told the
    -- ask existed — `planning.quiet_ask_created` is addressed to the circle
    -- without naming who — so an event saying it has been cancelled tells them
    -- both that it existed and, by its timing, who ended it (§14).
    when 'cancel' then case p_from_state
      when 'confirmed' then 'confirmation.meetup_cancelled'
      when 'seeking' then null
      else 'planning.plan_cancelled'
    end
    else null
  end;
$$;

comment on function planning.event_for(text, text) is
  'The outbox event a transition announces. Total over planning.transitions except the named silent bookkeeping actions, by test.';

revoke all on function planning.event_for(text, text) from public;
revoke all on function planning.event_for(text, text) from anon, authenticated;

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
  -- The days a custom plan asks about, when it has gaps (ADR 00ZZ): sorted,
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
  if p_days is not null and (
    cardinality(p_days) = 0
    or p_days is distinct from (select array_agg(distinct d order by d) from unnest(p_days) d)
    or p_days[1] <> p_window_start
    or p_days[cardinality(p_days)] <> p_window_end
  ) then
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
  return planning.transition_plan(created.id, 'create_named', caller);
end;
$$;

comment on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) is
  'Creates a named plan as a draft, addresses it to the circle''s active members, and moves it to collecting through the state machine. Defaults are resolved by the domain before it is called.';

revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) from public;
revoke all on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) from anon, authenticated;
grant execute on function public.create_plan(uuid, text, text, date, date, integer, integer, integer, integer, timestamptz, uuid[], date[]) to authenticated;

-- supabase/sql/functions/public/dispatch_context.sql
-- ---------------------------------------------------------------------------
-- Everything the dispatcher needs to decide who hears about a plan, read once.
--
-- The rules themselves are `packages/domain/communication`'s and stay there
-- (non-negotiable 2): `recipientsFor` is a pure function of state, which is
-- what makes "a reminder to somebody who said they cannot come" testable
-- without Resend. This is the state. It is one statement for the reason
-- `public.engine_input` is one statement — an eligibility decision taken from
-- a roster read at one moment and answers read at another is a decision about
-- a circle that never existed.
--
-- What it deliberately does **not** carry: the initiator of a quiet ask (read
-- `private.plan_initiators` only where a kind needs it, and never into a job),
-- any email address (ids only; the address is read once, by the sender, from
-- `dispatch_claim_due`), and anyone's availability windows (eligibility needs
-- statuses, never times).
--
-- Names and titles *are* here, because the templates render them. This value
-- goes to the service role and to nowhere else: never to the outbox, never to
-- `analytics`, never to a log line (non-negotiable 8).
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_context(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'circle', to_jsonb(c) - 'created_at' - 'updated_at' - 'creation_key',
    'plan', to_jsonb(p) - 'created_at' - 'updated_at',
    -- The days the plan asks about when it has gaps, else null (ADR 00ZZ), so
    -- a message that names the dates names only those.
    'days', (
      select jsonb_agg(d.day order by d.day) from public.plan_days d where d.plan_id = p.id
    ),
    'organiser_name', (
      select m.display_name_snapshot from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = p.organiser_user_id
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', m.circle_id, 'user_id', m.user_id, 'display_name', m.display_name_snapshot,
        'role', m.role, 'status', m.status, 'joined_at', m.joined_at,
        'muted_quiet_asks', m.muted_quiet_asks, 'muted_all', m.muted_all,
        -- "Nudges to plan the next one" (S2-04). Only the cadence nudge reads
        -- it, and that has its own context; carried here too so that one row
        -- shape serves both, and the domain's `Member` is whole in each.
        'muted_nudges', m.muted_nudges,
        'time_zone', coalesce(pr.time_zone, c.time_zone),
        'is_permanent', coalesce(pr.is_permanent, false),
        -- "Emails about plans you organise" (ADR 0029): a person's, not a
        -- membership's, carried on the member row because that is where the
        -- dispatcher looks a person up. `mutedOrganiserEmail` reads it.
        'muted_organiser_email', coalesce(pr.muted_organiser_email, false)
      ) order by m.joined_at, m.user_id)
      from public.circle_members m
      left join public.profiles pr on pr.user_id = m.user_id
      where m.circle_id = p.circle_id
    ), '[]'::jsonb),
    'participant_ids', coalesce((
      select jsonb_agg(pp.user_id order by pp.user_id) from public.plan_participants pp
      where pp.plan_id = p.id and pp.revision = p.revision
    ), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', r.plan_id, 'revision', r.revision, 'user_id', r.user_id, 'status', r.status
      ) order by r.user_id)
      from public.plan_responses r
      where r.plan_id = p.id and r.revision = p.revision
    ), '[]'::jsonb),
    -- Who answered an **earlier** revision, for `asked_again` (ADR 00YY): an
    -- edit cleared their times and they are the ones to ask back. Ids only;
    -- the earlier answers are never read (availability is scoped to one
    -- revision). The same people the app tells the plan changed (SUS-130).
    'answered_earlier', coalesce((
      select jsonb_agg(distinct r.user_id)
      from public.plan_responses r
      where r.plan_id = p.id and r.revision < p.revision
    ), '[]'::jsonb),
    -- The live confirmation for the revision this plan is on, and the one a
    -- reopen or a cancellation just superseded. `changed` needs the second:
    -- "the time we had is off" is a sentence about a start that is no longer
    -- on the plan.
    'confirmation', (
      select to_jsonb(mc) - 'created_at' - 'updated_at'
      from public.meetup_confirmations mc
      where mc.plan_id = p.id and mc.status = 'active'
      order by mc.confirmed_at desc limit 1
    ),
    'superseded_confirmation', (
      select to_jsonb(mc) - 'created_at' - 'updated_at'
      from public.meetup_confirmations mc
      where mc.plan_id = p.id and mc.status <> 'active'
      order by mc.superseded_at desc nulls last, mc.confirmed_at desc limit 1
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', a.confirmation_id, 'user_id', a.user_id, 'status', a.status
      ) order by a.user_id)
      from public.attendance a
      join public.meetup_confirmations mc on mc.id = a.confirmation_id
      where mc.plan_id = p.id
    ), '[]'::jsonb),
    -- Verified contact, active subscription, active member — the join that
    -- `hasPlanEmailSubscription` actually means, written once in S1-18 and not
    -- worked out again here.
    'email_recipients', coalesce((
      select jsonb_agg(jsonb_build_object('contact_id', e.contact_id, 'user_id', e.user_id))
      from private.email_recipients_for(p.id) e
    ), '[]'::jsonb),
    'push_user_ids', coalesce((
      select jsonb_agg(distinct d.user_id) from private.push_devices d
      join public.circle_members m on m.user_id = d.user_id and m.circle_id = p.circle_id
      where d.enabled
    ), '[]'::jsonb),
    -- The top eligible option of the set that matches where the plan is now,
    -- for `options_ready`. A stale set is no answer: the organiser would be
    -- told about a time somebody has since said they cannot make.
    'best_candidate', (
      select jsonb_build_object(
        'starts_at', cd.starts_at, 'available_count', cardinality(cd.available_user_ids))
      from public.candidate_sets cs
      join public.candidates cd on cd.candidate_set_id = cs.id
      where cs.plan_id = p.id and cs.revision = p.revision and cs.input_version = p.input_version
        and not cd.is_near_miss
      order by cd.rank limit 1
    ),
    -- "At most one deadline reminder per member per plan" spans revisions, so
    -- it cannot come from the idempotency key: an edit bumps the revision and
    -- the key alone would re-remind everybody. `EligibilityContext.alreadySent`.
    'already_reminded', coalesce((
      select jsonb_agg(distinct coalesce(j.user_id, ec.user_id))
      from jobs.notification_jobs j
      left join private.email_contacts ec on ec.id = j.contact_id
      where j.plan_id = p.id and j.kind = 'deadline_approaching'
    ), '[]'::jsonb)
  )
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.id = p_plan_id;
$$;

comment on function public.dispatch_context(uuid) is
  'One plan''s circle, roster (with each member''s organiser-email switch), participants, answers (and who answered an earlier revision), confirmations, attendance, email recipients and top candidate, read together, for the dispatcher''s eligibility rules. Ids and display names; never an address, a token or an availability window. Service role only (S1-20).';

revoke all on function public.dispatch_context(uuid) from public;
revoke all on function public.dispatch_context(uuid) from anon, authenticated;
grant execute on function public.dispatch_context(uuid) to service_role;

-- supabase/sql/functions/public/enforce_plan_days.sql
-- ---------------------------------------------------------------------------
-- A plan's listed days agree with its window (ADR 00ZZ).
--
-- `plan_days` holds the days a plan asks about **only when it has gaps**. No
-- rows means every day from `window_start` to `window_end`, which is every
-- preset and every plan stored before a plan could have gaps — so nothing had
-- to be backfilled and the four presets write nothing here. Rows, when there
-- are any, are the days: the first is `window_start`, the last is
-- `window_end`, and at least one day between them is missing, so one set of
-- days has one way to be stored.
--
-- A deferred constraint trigger on both tables rather than a check on either,
-- because the rule is about the two together and `revise_plan` moves them in
-- two statements: the window first, through `transition_plan`, and then the
-- rows. Checked once, at commit, on whatever the transaction left behind.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_plan_days()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target uuid;
  plan public.plans;
  first_day date;
  last_day date;
  listed integer;
begin
  if tg_table_name = 'plans' then
    target := new.id;
  elsif tg_op = 'DELETE' then
    target := old.plan_id;
  else
    target := new.plan_id;
  end if;

  select * into plan from public.plans p where p.id = target;
  -- The plan has gone, and its rows went with it (`on delete cascade`).
  if not found then
    return null;
  end if;

  select min(d.day), max(d.day), count(*)::integer into first_day, last_day, listed
  from public.plan_days d where d.plan_id = target;

  if listed = 0 then
    return null;
  end if;

  if first_day <> plan.window_start or last_day <> plan.window_end then
    raise exception 'days_invalid: the days of plan % run % to %, its window % to %',
      target, first_day, last_day, plan.window_start, plan.window_end
      using errcode = 'check_violation';
  end if;

  if listed = (plan.window_end - plan.window_start) + 1 then
    raise exception 'days_invalid: plan % lists every day of its window; no rows means that',
      target
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function public.enforce_plan_days() is
  'Deferred: a plan''s listed days start and end on its window''s ends and leave at least one day out; no rows means every day (ADR 00ZZ).';

revoke all on function public.enforce_plan_days() from public;
revoke all on function public.enforce_plan_days() from anon, authenticated;

-- supabase/sql/functions/public/enforce_window_shape.sql
-- Alignment is judged in the **plan's zone**, not UTC. The ticket's sketch had
-- `extract(minute from starts_at at time zone 'UTC') in (0, 30)`, and that is
-- wrong for every zone that is not a whole hour off UTC: Kathmandu is +05:45,
-- so a window painted 09:00–10:00 there is 03:15–04:15 UTC and would have been
-- refused, while 09:15 local would have passed. S1-03 hit exactly this in the
-- domain, and the database has to agree with it.

create or replace function public.enforce_window_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  response public.plan_responses;
  plan public.plans;
  local_start timestamp;
  local_end timestamp;
  day date;
  day_band_start timestamp;
  day_band_end timestamp;
begin
  select * into response from public.plan_responses r where r.id = new.response_id;
  select * into plan from public.plans p where p.id = response.plan_id;

  -- Windows belong to a `windows` answer and nothing else: a `not_this_time`
  -- with a window attached would be availability the person had withdrawn.
  if response.status <> 'windows' then
    raise exception 'a % response carries no windows', response.status
      using errcode = 'check_violation';
  end if;

  local_start := new.starts_at at time zone plan.time_zone;
  local_end := new.ends_at at time zone plan.time_zone;

  if extract(minute from local_start)::integer % 30 <> 0
     or extract(second from local_start) <> 0
     or extract(minute from local_end)::integer % 30 <> 0
     or extract(second from local_end) <> 0 then
    raise exception 'window %–% is not on a half hour in %', new.starts_at, new.ends_at, plan.time_zone
      using errcode = 'check_violation';
  end if;

  -- Inside the plan: the whole window fits the band of the day it starts on.
  -- Judged on the local clock so the day the clocks change reads the way the
  -- person saw it, and the band end may be 1440 — midnight, which rolls into
  -- the next date and is why the end is compared as an instant rather than as
  -- minutes-of-day.
  --
  -- One day, deliberately. The first version checked the end only when it fell
  -- on the same date as the start, so 18:30 Thursday to 20:30 Friday sailed
  -- through with the whole night inside it — availability the person never
  -- painted, which the engine would then have offered. The domain's
  -- `isWithinPlan` is containment in one day's band; this is the same rule.
  day := local_start::date;
  day_band_start := day::timestamp + make_interval(mins => plan.daily_start_local);
  day_band_end := day::timestamp + make_interval(mins => plan.daily_end_local);
  if day < plan.window_start or day > plan.window_end
     or local_start < day_band_start or local_end > day_band_end then
    raise exception 'window %–% lies outside the plan''s daily band', new.starts_at, new.ends_at
      using errcode = 'check_violation';
  end if;

  -- And on a day the plan asks about (ADR 00ZZ). No rows is every day of the
  -- window, which the test above has already settled; rows are the days, and
  -- a window on a day between them that is not one of them is availability
  -- for a question nobody was asked.
  --
  -- Raised by the name `submit-availability` already answers with, and no
  -- times in the text: an organiser can take a day away between that
  -- function's own check and this insert, and the person should hear the
  -- refusal their editor knows what to do with (it fetches the plan again),
  -- not an error nobody can read.
  if exists (select 1 from public.plan_days d where d.plan_id = plan.id)
    and not exists (
      select 1 from public.plan_days d where d.plan_id = plan.id and d.day = local_start::date
    )
  then
    raise exception 'outside_plan_window' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_window_shape() is
  'Half-hour aligned in the plan''s zone, inside the plan''s window and band, on a day it asks about, and attached to a `windows` response. Mirrors normaliseWindows() in packages/domain/src/availability/windows.ts.';

revoke all on function public.enforce_window_shape() from public;
revoke all on function public.enforce_window_shape() from anon, authenticated;

-- supabase/sql/functions/public/engine_input.sql
-- ---------------------------------------------------------------------------
-- Everything the candidate engine needs about a plan, in one read.
--
-- Three tables and a join, and the reason it is a function rather than three
-- queries from the Edge Function is that the engine's answer is only as
-- trustworthy as the inputs agreeing with each other. Read separately, the
-- roster can change between the members query and the responses query, and the
-- set that comes out is one nobody ever had: a member who answered and is no
-- longer there, or one who joined between the two statements and appears as a
-- non-responder to a question they were never asked. One statement is one
-- snapshot.
--
-- It is `stable`, and deliberately takes no lock: the compare-and-set in
-- `store_candidate_set` is what makes a stale result harmless, so reading
-- without blocking answers is right. A recalculation that loses the race is
-- discarded and another follows.
--
-- In `public` because PostgREST exposes nothing else, and granted to
-- `service_role` alone: this returns every member's answer to a plan, which is
-- precisely what `plan_responses_select_own` exists to stop a client seeing
-- (spec §5.5 — "your friends will only see a combined result"). The combined
-- result is what `candidates` holds, and that is the table clients read.
-- ---------------------------------------------------------------------------

create or replace function public.engine_input(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan', jsonb_build_object(
      'id', p.id,
      'circle_id', p.circle_id,
      'state', p.state,
      'revision', p.revision,
      'input_version', p.input_version,
      'scoring_version', p.scoring_version,
      'time_zone', p.time_zone,
      'window_start', p.window_start,
      'window_end', p.window_end,
      -- The days asked about when the window has gaps, else null: every day
      -- (ADR 00ZZ). The engine offers no time on a day that is not listed.
      'days', (
        select jsonb_agg(d.day order by d.day)
        from public.plan_days d where d.plan_id = p.id
      ),
      'daily_start_local', p.daily_start_local,
      'daily_end_local', p.daily_end_local,
      'duration_minutes', p.duration_minutes,
      'quorum', p.quorum,
      'response_deadline', p.response_deadline,
      'required_member_ids', (
        select coalesce(jsonb_agg(rm.user_id order by rm.user_id), '[]'::jsonb)
        from public.plan_required_members rm
        where rm.plan_id = p.id and rm.revision = p.revision
      )
    ),
    -- **Who the plan was asked of**, not who is in the circle. The two are
    -- different lists and the database already says which one means what:
    -- `plan_participants` is the audience of a revision, `replace_response`
    -- refuses anybody else with `not_a_participant`, and `transition_plan`
    -- carries the audience across an edit rather than recomputing it, because
    -- spec §9 makes joining an active plan an opt-in — "new members may opt into
    -- the active plan", not "new members are added to it".
    --
    -- Reading `circle_members` here would have been a second definition of the
    -- same thing, and the two disagree the moment somebody joins mid-plan: the
    -- engine would count them in `active_member_count`, the screens would show
    -- "4 of 7" and a dashed mark against a person who was never asked and whom
    -- `replace_response` will not let answer.
    --
    -- Still filtered on active membership, because a participant who has left is
    -- not being asked either. Order is part of the input rather than a detail of
    -- the read — every available list the engine returns is sorted into it, and
    -- `inputHash` includes it unsorted for that reason.
    'active_member_ids', (
      select coalesce(jsonb_agg(pp.user_id order by pp.joined_at, pp.user_id), '[]'::jsonb)
      from public.plan_participants pp
      join public.circle_members m
        on m.circle_id = p.circle_id and m.user_id = pp.user_id and m.status = 'active'
      where pp.plan_id = p.id and pp.revision = p.revision
    ),
    -- Answers to the revision being asked, from people who are still being
    -- asked. The engine filters by the roster too — it walks `active_member_ids`
    -- — and this filter is what keeps `responded_count` honest as well: a plan
    -- whose one reply came from somebody who has left is still waiting for its
    -- first.
    'responses', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'user_id', r.user_id,
            'status', r.status,
            'windows', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object('start', w.starts_at, 'end', w.ends_at)
                  order by w.starts_at
                ),
                '[]'::jsonb
              )
              from public.willing_windows w
              where w.response_id = r.id
            )
          )
          order by r.user_id
        ),
        '[]'::jsonb
      )
      from public.plan_responses r
      join public.plan_participants pp
        on pp.plan_id = r.plan_id and pp.revision = r.revision and pp.user_id = r.user_id
      join public.circle_members m
        on m.circle_id = p.circle_id and m.user_id = r.user_id and m.status = 'active'
      where r.plan_id = p.id and r.revision = p.revision
    )
  )
  from public.plans p
  where p.id = p_plan_id;
$$;

comment on function public.engine_input(uuid) is
  'One consistent snapshot of a plan, its active roster and the answers to its current revision, shaped for generateCandidates. Service role only: it carries every member''s answer.';

revoke all on function public.engine_input(uuid) from public;
revoke all on function public.engine_input(uuid) from anon, authenticated;
grant execute on function public.engine_input(uuid) to service_role;

-- supabase/sql/functions/public/picked_days.sql
-- ---------------------------------------------------------------------------
-- The days somebody has picked: the fact that decides what taking a day away
-- costs (ADR 00ZZ).
--
-- Removing a day **nobody** picked keeps everybody's answers and starts no
-- new revision; removing a day somebody picked is a new question (ADR 0017).
-- `revise_plan` decides that under the plan's lock by calling this, and the
-- edit screen's preview calls it too, so the warning shown before saving and
-- the save itself read the same days the same way — the argument
-- `reask_audience` makes about who has answered.
--
-- Dates only. Not whose, not how many, not when on the day: the organiser
-- learns that *somebody* is free some time on Tuesday, which the day grid's
-- combined counts already tell every member (SUS-129). Every answer to the
-- current revision counts, the organiser's own included: their answer is
-- cleared by a new revision like anybody's.
--
-- Organiser-only, as `reask_audience` is, and for its reason: a preview of an
-- edit somebody cannot make is information they should not have.
-- ---------------------------------------------------------------------------

create or replace function public.picked_days(p_plan_id uuid)
returns setof date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan public.plans;
begin
  select * into plan from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  if plan.organiser_user_id is distinct from (select auth.uid())
    or not exists (
      select 1 from public.circle_members m
      where m.circle_id = plan.circle_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  -- The day a window starts on, in the plan's zone: `enforce_window_shape`
  -- holds every window inside the band of the day it starts on.
  return query
  select distinct (w.starts_at at time zone plan.time_zone)::date
  from public.plan_responses r
  join public.willing_windows w on w.response_id = r.id
  where r.plan_id = plan.id and r.revision = plan.revision
  order by 1;
end;
$$;

comment on function public.picked_days(uuid) is
  'The dates on which some answer to the plan''s current revision has times, for its organiser: what decides whether taking a day away asks people again (ADR 00ZZ).';

revoke all on function public.picked_days(uuid) from public;
revoke all on function public.picked_days(uuid) from anon, authenticated;
grant execute on function public.picked_days(uuid) to authenticated;

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
  -- the window's ends (ADR 00ZZ). Null leaves them alone — unless the window's
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

  -- The days (ADR 00ZZ), as the plan asks about them now and as it would.
  -- No rows in `plan_days` is every day of the window, so both sides are
  -- spelled out as lists and compared as lists, whatever form each is stored in.
  new_start := coalesce((p_payload ->> 'window_start')::date, plan.window_start);
  new_end := coalesce((p_payload ->> 'window_end')::date, plan.window_end);
  if p_days is not null and (
    cardinality(p_days) = 0
    or p_days is distinct from (select array_agg(distinct d order by d) from unnest(p_days) d)
    or p_days[1] <> new_start
    or p_days[cardinality(p_days)] <> new_end
  ) then
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
  -- chose that it should not cost anybody a reply (ADR 00ZZ). Decided here,
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
  -- the set is recomputed as it is after a quorum change. No candidate can sit
  -- on a day nobody picked, so the set that comes back is the same one; the
  -- version says it was computed from the plan as it now is.
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

-- After the definitions, because the trigger function is one of them.
-- Deferred, because `revise_plan` moves the window and then the rows.
create constraint trigger plan_days_agree_with_window
  after insert or update or delete on public.plan_days
  deferrable initially deferred
  for each row execute function public.enforce_plan_days();

create constraint trigger plans_window_agrees_with_days
  after update of window_start, window_end on public.plans
  deferrable initially deferred
  for each row execute function public.enforce_plan_days();
