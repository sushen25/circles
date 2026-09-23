-- Local seed. Runs on `supabase db reset`, never in a deployed environment.
--
-- pgTAP is created here rather than in a migration deliberately: the test
-- harness needs it, and production has no business carrying a testing
-- extension it will never call.
create extension if not exists pgtap with schema extensions;

-- ---------------------------------------------------------------------------
-- Scenarios (architecture §7.1, spec §16).
--
-- Five circles, written **through the same writers the product uses** —
-- `transition_plan`, `replace_response`, attendance and `report_outcome` —
-- so that every trigger fires, every invariant holds and the outbox fills the
-- way it does in production. A seed that inserts rows directly is a seed that
-- can describe a state the product cannot reach. The one exception is the
-- circle row itself, for the sake of a fixed id; see `seed_circle`.
--
--   A. Sunday Crew, mid-plan — the canvas's circle: Maya, Priya, Tom, Jess,
--      Sam have answered, Alex has not, candidates are generated. The partial
--      state is the most common real one and every screen has to read in it.
--   B. Thursday Regulars — a confirmed meetup that happened, with an outcome
--      reported; `last_met_at` is set.
--   C. Uni Mates — a quiet ask in `seeking`, two keen of a threshold of three.
--   D. The Big Table — a circle at `member_cap()` (ADR 0012), where the
--      screens break if they are going to.
--   E. Book Club — a meetup locked in for the week after next (S1-23), so
--      circle home's "locked in" state has something to show.
--
-- Ids are deterministic (`00000000-0000-4000-8000-0000000001NN` for people,
-- `…0a0N` for circles, `…0b0N` for plans) so a URL survives a reset. Dates are
-- relative to today, because a seeded plan whose deadline has passed is a
-- plan nothing can answer.
-- ---------------------------------------------------------------------------

begin;

create or replace function pg_temp.seed_user(id uuid, name text, anonymous boolean default false)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    case when anonymous then null else lower(name) || '@example.com' end,
    -- A saved place got here by typing a code back from their inbox, which is
    -- what GoTrue records as `email_confirmed_at`. Left null, the seed's
    -- permanent identities had an address nothing was allowed to write to, and
    -- the organiser emails — options ready, replies closed, did it happen —
    -- were silently absent from every local scenario (S1-20).
    case when anonymous then null else now() end,
    anonymous, jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- A local window on a date, in Melbourne, as `replace_response` takes it.
create or replace function pg_temp.win(day date, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

-- A circle with a fixed id and short code. `create_circle` mints both at
-- random, and a seed whose URLs change on every reset is a seed nobody
-- bookmarks — so the two rows it writes are written here instead, the same
-- two rows, and the row triggers announce the creation either way.
create or replace function pg_temp.seed_circle(
  id uuid, owner uuid, name text, color text, code text, key text, cadence text default 'none'
)
returns void language sql as $$
  insert into public.circles (id, owner_user_id, name, color, time_zone, cadence, short_code, creation_key)
  values (id, owner, name, color, 'Australia/Melbourne', cadence, code, key);
  insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
  select id, owner, p.display_name, 'owner' from public.profiles p where p.user_id = owner;
$$;

-- Members join as the product joins them: a membership row (redeem-invite,
-- S1-13, will insert the same row).
create or replace function pg_temp.join_circle(circle uuid, member uuid)
returns void language sql as $$
  insert into public.circle_members (circle_id, user_id, display_name_snapshot)
  select circle, member, p.display_name from public.profiles p where p.user_id = member;
$$;

-- A named plan, created the way create-plan (S1-15) creates one: a draft row,
-- the participants, then the `create_named` transition by its organiser.
--
-- The band is 9 am to 10:30 pm, wide on purpose: the editor offers only the
-- blocks the plan asks about (ADR 0024), so an evenings-only seed has one chip
-- and Morning, Afternoon and Any time can never be tapped by hand. A plan a
-- real organiser would make is narrower; the live tests each build their own
-- plan (`tests/e2e-live/stack.ts`), so they still cover the narrow case.
create or replace function pg_temp.named_plan(
  id uuid, circle uuid, organiser uuid, code text, day_from date, day_to date,
  quorum integer, deadline timestamptz
)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as_postgres();
  insert into public.plans (
    id, circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  ) values (
    id, circle, 'named', 'draft', organiser, 'Catch up', 'Australia/Melbourne',
    day_from, day_to, 9 * 60, 22 * 60 + 30, 120, quorum, deadline, code
  );
  insert into public.plan_participants (plan_id, revision, user_id)
  select id, 1, m.user_id from public.circle_members m where m.circle_id = circle and m.status = 'active';
  perform planning.transition_plan(id, 'create_named', organiser);
end;
$$;

-- The people. Alex is a guest — joined from the chat link, never signed in —
-- because the guest-to-saved-place journey (spec §5.11) needs one to exist.
select pg_temp.seed_user('00000000-0000-4000-8000-000000000101', 'Maya');
select pg_temp.seed_user('00000000-0000-4000-8000-000000000102', 'Priya');
select pg_temp.seed_user('00000000-0000-4000-8000-000000000103', 'Tom');
select pg_temp.seed_user('00000000-0000-4000-8000-000000000104', 'Jess');
select pg_temp.seed_user('00000000-0000-4000-8000-000000000105', 'Sam');
select pg_temp.seed_user('00000000-0000-4000-8000-000000000106', 'Alex', true);
select pg_temp.seed_user('00000000-0000-4000-8000-000000000107', 'Nic');

-- Dates: the plan window is the coming week, Monday to Sunday — reset on a
-- Thursday 10 September and the Sunday Crew's Thursday is the 17th, the
-- scenario's own date (AGENTS.md). On a Monday, next Monday, not today.
create temporary table dates on commit drop as
select
  (current_date + case extract(isodow from current_date)::integer when 1 then 7 else (8 - extract(isodow from current_date)::integer) % 7 end)::date as next_monday;
grant select on dates to authenticated;

-- ---------------------------------------------------------------------------
-- A. Sunday Crew, mid-plan.
-- ---------------------------------------------------------------------------

select pg_temp.seed_circle('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000101',
  'Sunday Crew', 'sky', 'sundaycrew', 'seed-sunday-crew', 'monthly');
-- The canvas's "last caught up": Saturday 8 August 2026, 6:30 pm Melbourne.
update public.circles set last_met_at = timestamptz '2026-08-08T08:30:00Z'
where id = '00000000-0000-4000-8000-000000000a01';

select pg_temp.join_circle('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000102');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000103');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000104');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000105');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000106');

select pg_temp.named_plan(
  '00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000a01',
  '00000000-0000-4000-8000-000000000101', 'pnsundaycr',
  (select next_monday from dates), (select next_monday + 6 from dates),
  4, ((select next_monday + 1 from dates)::timestamp + interval '8 hours') at time zone 'Australia/Melbourne'
);

-- Five answers; Alex outstanding. Everyone who answered can do Thursday
-- 6:30–8:30; Priya, Tom and Jess can also do Friday; Sam and Priya Saturday
-- from 5:30. Exact two-hour windows, so the engine has one start per day.
select pg_temp.act_as('00000000-0000-4000-8000-000000000101');
select public.replace_response('00000000-0000-4000-8000-000000000b01', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as('00000000-0000-4000-8000-000000000102');
select public.replace_response('00000000-0000-4000-8000-000000000b01', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30),
  pg_temp.win((select next_monday + 4 from dates), 18 * 60 + 30, 20 * 60 + 30),
  pg_temp.win((select next_monday + 5 from dates), 17 * 60 + 30, 19 * 60 + 30)));
select pg_temp.act_as('00000000-0000-4000-8000-000000000103');
select public.replace_response('00000000-0000-4000-8000-000000000b01', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30),
  pg_temp.win((select next_monday + 4 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as('00000000-0000-4000-8000-000000000104');
select public.replace_response('00000000-0000-4000-8000-000000000b01', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30),
  pg_temp.win((select next_monday + 4 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as('00000000-0000-4000-8000-000000000105');
select public.replace_response('00000000-0000-4000-8000-000000000b01', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30),
  pg_temp.win((select next_monday + 5 from dates), 17 * 60 + 30, 19 * 60 + 30)));

-- The candidate set the engine would produce from those answers (S1-16
-- computes it in production; the seed writes the same rows by hand, and
-- the same way — 168 starts considered, twenty-four half-hours a day that fit
-- two hours inside 9 am–10:30 pm, over seven days; the quorum is 4, so Thursday with five is the one eligible
-- option and Friday with three and Saturday with two are near misses, short
-- by one and by two — ADR 0011).
select pg_temp.act_as_postgres();
insert into public.candidate_sets (
  id, plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select '00000000-0000-4000-8000-000000000c01', p.id, p.revision, p.input_version, p.scoring_version, 'seed',
  168, 1, 5, 6
from public.plans p where p.id = '00000000-0000-4000-8000-000000000b01';

insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count, near_miss_reason
)
select '00000000-0000-4000-8000-000000000c01'::uuid, false, 1,
  ((next_monday + 3)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
  ((next_monday + 3)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
  array['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102',
        '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104',
        '00000000-0000-4000-8000-000000000105']::uuid[],
  5, 0, 'best_attendance', 5, null::jsonb
from dates
union all
select '00000000-0000-4000-8000-000000000c01', true, 1,
  ((next_monday + 4)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
  ((next_monday + 4)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
  array['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103',
        '00000000-0000-4000-8000-000000000104']::uuid[],
  3, 0, 'closest', 3, '{"kind": "quorum_short", "by": 1}'::jsonb
from dates
union all
select '00000000-0000-4000-8000-000000000c01', true, 2,
  ((next_monday + 5)::timestamp + interval '17 hours 30 minutes') at time zone 'Australia/Melbourne',
  ((next_monday + 5)::timestamp + interval '19 hours 30 minutes') at time zone 'Australia/Melbourne',
  array['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000105']::uuid[],
  2, 0, 'closest', 2, '{"kind": "quorum_short", "by": 2}'::jsonb
from dates;

select planning.transition_plan('00000000-0000-4000-8000-000000000b01', 'candidates_ready',
  '00000000-0000-4000-8000-000000000101');

-- ---------------------------------------------------------------------------
-- B. Thursday Regulars — met four weeks ago, and said so.
-- ---------------------------------------------------------------------------

select pg_temp.seed_circle('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000107',
  'Thursday Regulars', 'moss', 'thursdays', 'seed-thursday-regulars', 'monthly');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000102');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000103');

-- A meetup in the past cannot be made through the writers — `confirm` refuses
-- a candidate whose start has gone, and `replace_response` an answer after
-- the deadline, both rightly. So it is made in the present, next week like
-- the others, and then the clock is moved by hand as the owner: the plan's
-- window and the confirmation's time go back five weeks, and the outcome is
-- reported on what is by then last month's evening.
select pg_temp.named_plan(
  '00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000a02',
  '00000000-0000-4000-8000-000000000107', 'pnthursday',
  (select next_monday from dates), (select next_monday + 6 from dates),
  2, ((select next_monday + 1 from dates)::timestamp + interval '8 hours') at time zone 'Australia/Melbourne'
);
-- All three can do Thursday.
select pg_temp.act_as('00000000-0000-4000-8000-000000000107');
select public.replace_response('00000000-0000-4000-8000-000000000b02', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as('00000000-0000-4000-8000-000000000102');
select public.replace_response('00000000-0000-4000-8000-000000000b02', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as('00000000-0000-4000-8000-000000000103');
select public.replace_response('00000000-0000-4000-8000-000000000b02', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 3 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as_postgres();

insert into public.candidate_sets (
  id, plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select '00000000-0000-4000-8000-000000000c02', p.id, p.revision, p.input_version, p.scoring_version, 'seed',
  49, 1, 3, 3
from public.plans p where p.id = '00000000-0000-4000-8000-000000000b02';
insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select '00000000-0000-4000-8000-000000000c02'::uuid, false, 1,
  ((next_monday + 3)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
  ((next_monday + 3)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
  array['00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000102',
        '00000000-0000-4000-8000-000000000103']::uuid[],
  3, 0, 'best_attendance', 3
from dates;
select planning.transition_plan('00000000-0000-4000-8000-000000000b02', 'candidates_ready',
  '00000000-0000-4000-8000-000000000107');

-- Confirmed by Nic, with the place and the note the ConfirmedOrg artboard shows.
select planning.transition_plan('00000000-0000-4000-8000-000000000b02', 'confirm',
  '00000000-0000-4000-8000-000000000107',
  jsonb_build_object(
    'candidate_id', (select starts_at from public.candidates where candidate_set_id = '00000000-0000-4000-8000-000000000c02'),
    'place_name', 'Hope St Radio',
    'note', 'Table''s booked under my name. Come hungry.',
    'chased_answer', 'none'
  ));

-- Five weeks ago, now — the plan, the answers, the candidate and the
-- confirmation together, so the record is one the writers could have made.
-- The deadline trigger still holds (it compares the deadline with the
-- window, and both move together).
update public.plans
set window_start = window_start - 35, window_end = window_end - 35,
    response_deadline = response_deadline - interval '35 days',
    -- The plan was *made* five weeks ago too. Left at `now()`, the meetup
    -- happened five weeks before the plan that arranged it — which cannot
    -- happen in the product and made two analytics views disagree about the
    -- one meetup in the seed: `funnel_by_circle` counted it, and
    -- `north_star_monthly` filed it under a month its series never reached.
    created_at = created_at - interval '35 days'
where id = '00000000-0000-4000-8000-000000000b02';
update public.willing_windows w
set starts_at = w.starts_at - interval '35 days', ends_at = w.ends_at - interval '35 days'
from public.plan_responses r
where w.response_id = r.id and r.plan_id = '00000000-0000-4000-8000-000000000b02';
update public.candidates
set starts_at = starts_at - interval '35 days', ends_at = ends_at - interval '35 days'
where candidate_set_id = '00000000-0000-4000-8000-000000000c02';
update public.meetup_confirmations
set starts_at = starts_at - interval '35 days', ends_at = ends_at - interval '35 days',
    candidate_id = (starts_at - interval '35 days')::text,
    -- And it was decided before it happened, which is the order these things
    -- occur in.
    confirmed_at = confirmed_at - interval '36 days'
where plan_id = '00000000-0000-4000-8000-000000000b02';

-- The circle existed before any of it. `circle_activation` reads this to decide
-- whether a circle got going within seven days (§11.2), and a circle created
-- after its own first meetup is not a scenario anybody can learn from.
update public.circles
set created_at = created_at - interval '40 days'
where id = '00000000-0000-4000-8000-000000000a02';

-- The morning after: Priya was there, Tom was not; Nic says it happened.
create or replace function pg_temp.conf_b() returns uuid language sql as $$
  select id from public.meetup_confirmations
  where plan_id = '00000000-0000-4000-8000-000000000b02' and status = 'active';
$$;
select pg_temp.act_as('00000000-0000-4000-8000-000000000102');
update public.attendance set status = 'was_there'
where confirmation_id = pg_temp.conf_b() and user_id = '00000000-0000-4000-8000-000000000102';
select pg_temp.act_as('00000000-0000-4000-8000-000000000103');
update public.attendance set status = 'missed'
where confirmation_id = pg_temp.conf_b() and user_id = '00000000-0000-4000-8000-000000000103';
select pg_temp.act_as('00000000-0000-4000-8000-000000000107');
select public.report_outcome(pg_temp.conf_b(), 'happened', null, false);
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- C. Uni Mates — a quiet ask, still seeking.
-- ---------------------------------------------------------------------------

select pg_temp.seed_circle('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000104',
  'Uni Mates', 'clay', 'unmates', 'seed-uni-mates');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000105');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000101');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000103');

-- Sam asked quietly. Who asked lives in `private` and nowhere else.
insert into public.plans (
  id, circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code, quiet_threshold
)
select '00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000a03', 'quiet', 'draft', null,
  'Drinks', 'Australia/Melbourne', next_monday + 7, next_monday + 13, 17 * 60 + 30, 22 * 60 + 30,
  120, 3, ((next_monday + 8)::timestamp + interval '8 hours') at time zone 'Australia/Melbourne', 'pnunmates', 3
from dates;
insert into public.plan_participants (plan_id, revision, user_id)
select '00000000-0000-4000-8000-000000000b03', 1, m.user_id
from public.circle_members m where m.circle_id = '00000000-0000-4000-8000-000000000a03' and m.status = 'active';
insert into private.plan_initiators (plan_id, initiator_user_id)
values ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000105');
select planning.transition_plan('00000000-0000-4000-8000-000000000b03', 'create_quiet',
  '00000000-0000-4000-8000-000000000105');
insert into private.plan_interest (plan_id, user_id, response) values
  ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000105', 'keen'),
  ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000101', 'keen');

-- ---------------------------------------------------------------------------
-- D. The Big Table — exactly member_cap() people.
-- ---------------------------------------------------------------------------

select pg_temp.seed_circle('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000101',
  'The Big Table', 'plum', 'bgtabde', 'seed-big-table');

-- Nineteen more, up to the cap and not past it: the cap is read, not typed.
do $$
declare
  names text[] := array[
    'Aisha', 'Ben', 'Chloe', 'Dev', 'Ella', 'Finn', 'Grace', 'Hugo', 'Isla', 'Jack',
    'Kai', 'Leo', 'Mia', 'Noah', 'Olive', 'Ravi', 'Sofia', 'Theo', 'Zara', 'Yusuf', 'Wren'
  ];
  i integer := 0;
  member uuid;
begin
  while (select count(*) from public.circle_members m
         where m.circle_id = '00000000-0000-4000-8000-000000000a04' and m.status = 'active') < public.member_cap()
  loop
    i := i + 1;
    member := ('00000000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid;
    perform pg_temp.seed_user(member, names[i]);
    perform pg_temp.join_circle('00000000-0000-4000-8000-000000000a04', member);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Book Club — locked in for the Thursday after next (S1-23).
--
-- The one scenario with a confirmed meetup still ahead, which is circle home's
-- "locked in" state and the circles list's "Locked in · Thu 24 Sep". Maya owns
-- it, so all three of circle home's states are one sign-in away: Sunday Crew
-- finding a time, Book Club locked in, The Big Table between catch-ups.
-- Priya has said she is going; Jess has not said yet.
-- ---------------------------------------------------------------------------

select pg_temp.seed_circle('00000000-0000-4000-8000-000000000a05', '00000000-0000-4000-8000-000000000101',
  'Book Club', 'plum', 'bkcrew', 'seed-book-club', 'monthly');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a05', '00000000-0000-4000-8000-000000000102');
select pg_temp.join_circle('00000000-0000-4000-8000-000000000a05', '00000000-0000-4000-8000-000000000104');

select pg_temp.named_plan(
  '00000000-0000-4000-8000-000000000b05', '00000000-0000-4000-8000-000000000a05',
  '00000000-0000-4000-8000-000000000101', 'pnbkcrew',
  (select next_monday + 7 from dates), (select next_monday + 13 from dates),
  2, ((select next_monday + 8 from dates)::timestamp + interval '8 hours') at time zone 'Australia/Melbourne'
);
select pg_temp.act_as('00000000-0000-4000-8000-000000000101');
select public.replace_response('00000000-0000-4000-8000-000000000b05', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 10 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as('00000000-0000-4000-8000-000000000102');
select public.replace_response('00000000-0000-4000-8000-000000000b05', 1, 'windows', jsonb_build_array(
  pg_temp.win((select next_monday + 10 from dates), 18 * 60 + 30, 20 * 60 + 30)));
select pg_temp.act_as_postgres();

insert into public.candidate_sets (
  id, plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
select '00000000-0000-4000-8000-000000000c05', p.id, p.revision, p.input_version, p.scoring_version, 'seed',
  168, 1, 2, 3
from public.plans p where p.id = '00000000-0000-4000-8000-000000000b05';
insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select '00000000-0000-4000-8000-000000000c05'::uuid, false, 1,
  ((next_monday + 10)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
  ((next_monday + 10)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
  array['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102']::uuid[],
  2, 0, 'best_attendance', 2
from dates;
select planning.transition_plan('00000000-0000-4000-8000-000000000b05', 'candidates_ready',
  '00000000-0000-4000-8000-000000000101');
select planning.transition_plan('00000000-0000-4000-8000-000000000b05', 'confirm',
  '00000000-0000-4000-8000-000000000101',
  jsonb_build_object(
    'candidate_id', (select starts_at from public.candidates where candidate_set_id = '00000000-0000-4000-8000-000000000c05'),
    'place_name', 'Hope St Radio',
    'chased_answer', 'none'
  ));
select pg_temp.act_as('00000000-0000-4000-8000-000000000102');
update public.attendance set status = 'going'
where user_id = '00000000-0000-4000-8000-000000000102'
  and confirmation_id = (select id from public.meetup_confirmations
                         where plan_id = '00000000-0000-4000-8000-000000000b05' and status = 'active');
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- The outbox now holds every event the scenarios produced. They are marked
-- processed: a local dispatcher (S1-20) would otherwise try to notify people
-- who do not exist about a seed. Clear `processed_at` to replay them.
-- ---------------------------------------------------------------------------

update jobs.outbox set processed_at = now() where processed_at is null;

commit;
