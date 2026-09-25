-- Replies closed with no decision (S2-05): hand-off, one more day, and the
-- letters around them.
--
-- Every function this ticket adds, both ways (AGENTS.md §6.4): who may, who may
-- not, and what each refusal is called. And the two dispatcher changes that
-- decide whether the organiser hears about a second closure and a stalled day
-- at all — which is the whole point of the ticket, and which review round 5 on
-- SUS-36 found the job layer silently throwing away.

begin;
select plan(52);

create or replace function pg_temp.make_user(id uuid, name text, permanent boolean)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', case when permanent then now() end, not permanent,
    jsonb_build_object('is_anonymous', not permanent),
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

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Maya organises. Priya and Tom have saved places; Sam is a guest; Jess has
-- left the circle; Ren joined after the plan was made, so it is not asking him.
select pg_temp.make_user('00000000-0000-0000-0000-0000000024a1', 'Maya', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000024a2', 'Priya', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000024a3', 'Tom', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000024a4', 'Sam', false);
select pg_temp.make_user('00000000-0000-0000-0000-0000000024a5', 'Jess', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000024a6', 'Ren', true);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-replies-closed');

select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id from public.circles where creation_key = 'key-replies-closed';
grant select on t to anon, authenticated, service_role;

insert into public.circle_members (circle_id, user_id, display_name_snapshot, status)
select circle_id, u.id, u.name, u.status from t,
  (values ('00000000-0000-0000-0000-0000000024a2'::uuid, 'Priya', 'active'),
          ('00000000-0000-0000-0000-0000000024a3'::uuid, 'Tom', 'active'),
          ('00000000-0000-0000-0000-0000000024a4'::uuid, 'Sam', 'active'),
          ('00000000-0000-0000-0000-0000000024a5'::uuid, 'Jess', 'removed'),
          ('00000000-0000-0000-0000-0000000024a6'::uuid, 'Ren', 'active')) as u (id, name, status);

-- The plan whose replies have closed: ready, deadline two hours ago, a window
-- a week out. And one for the edge the domain calls "nothing left to extend
-- into": its deadline sits at its own last possible start (ADR 0010).
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'ready', '00000000-0000-0000-0000-0000000024a1',
  'Catch up', 'Australia/Melbourne', (now() + interval '6 days')::date, (now() + interval '9 days')::date,
  1050, 1350, 120, 2, now() - interval '2 hours', 'rcsdtwxa'
from t;

create temporary table tp as
select (select id from public.plans where short_code = 'rcsdtwxa') as plan_id;
grant select on tp to anon, authenticated, service_role;
create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select plan_id from tp $$;

insert into public.plan_participants (plan_id, revision, user_id)
select pg_temp.plan_id(), 1, u.id from (values
  ('00000000-0000-0000-0000-0000000024a1'::uuid),
  ('00000000-0000-0000-0000-0000000024a2'::uuid),
  ('00000000-0000-0000-0000-0000000024a3'::uuid),
  ('00000000-0000-0000-0000-0000000024a4'::uuid)) as u (id);

-- ---------------------------------------------------------------------------
-- Who may call it
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.hand_off_organiser(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hand_off_candidates(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.extend_deadline(uuid)', 'execute'),
  'an anonymous caller reaches none of the three'
);
select ok(
  has_function_privilege('authenticated', 'public.hand_off_organiser(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.hand_off_candidates(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.extend_deadline(uuid)', 'execute'),
  'a signed-in member may call them, and each decides for itself whether they may'
);

-- ---------------------------------------------------------------------------
-- Who could take it: hand_off_candidates
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select results_eq(
  format($$ select display_name, has_saved_place from public.hand_off_candidates(%L)
            order by display_name $$, pg_temp.plan_id()),
  $$ values ('Priya'::text, true), ('Sam'::text, false), ('Tom'::text, true) $$,
  'the organiser sees everyone the plan asks but themselves, and which of them has a saved place — not Ren, whom it never asked'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a2');
select throws_ok(
  format($$ select * from public.hand_off_candidates(%L) $$, pg_temp.plan_id()),
  'P0001', 'not_the_organiser',
  'and nobody else is told who in the circle is a guest'
);

-- ---------------------------------------------------------------------------
-- One more day: extend_deadline
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000024a2');
select throws_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'P0001', 'not_the_organiser',
  'a member who is not organising cannot extend it'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select lives_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'the organiser gives it one more day'
);

select pg_temp.act_as_postgres();
select is(
  (select response_deadline from public.plans where id = pg_temp.plan_id()),
  now() + interval '24 hours',
  'a day from now, since the deadline had already gone'
);
select is(
  (select state || '/' || revision || '/' || deadline_extended_on_revision
   from public.plans where id = pg_temp.plan_id()),
  'ready/1/1',
  'an adjust: still ready, still revision 1, and revision 1''s extension is spent'
);
select ok(
  exists (
    select 1 from jobs.outbox o
    where o.event_name = 'planning.plan_revised' and o.aggregate_id = pg_temp.plan_id()
      and o.payload ->> 'action' = 'adjust'
  ),
  'announced the way any deadline change is: planning.plan_revised, as an adjust'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select throws_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'P0001', 'already_extended',
  'and a second extension on the same revision is refused'
);

-- A new revision is a new question and earns its own day. Rewound so it has
-- passed again, the way the screen would find it.
select pg_temp.act_as_postgres();
update public.plans set revision = 2, deadline_extended_on_revision = 1,
  response_deadline = now() - interval '1 hour'
where id = pg_temp.plan_id();

-- The cut-off: a one-day window whose last possible start, 10 pm on its
-- day, is between half an hour and a day and a half-hour away — so a day
-- from now would run past it, and the answer is thirty minutes before it.
update public.plans set
  window_start = ((now() at time zone 'Australia/Melbourne') + interval '150 minutes')::date,
  window_end = ((now() at time zone 'Australia/Melbourne') + interval '150 minutes')::date,
  daily_start_local = 0,
  daily_end_local = 1440
where id = pg_temp.plan_id();

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select lives_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'a new revision may be extended once more'
);
select pg_temp.act_as_postgres();
select is(
  (select p.response_deadline from public.plans p where p.id = pg_temp.plan_id()),
  (select public.plan_last_possible_start(p.window_end, p.daily_end_local, p.duration_minutes, p.time_zone)
     - interval '30 minutes'
   from public.plans p where p.id = pg_temp.plan_id()),
  'and never past thirty minutes before the last possible start'
);
select ok(
  (select p.response_deadline <= now() + interval '24 hours' from public.plans p where p.id = pg_temp.plan_id()),
  'which is less than a day here, and that is the rule working, not failing'
);

-- Nothing left to extend into: a deadline already at the cut-off.
update public.plans set deadline_extended_on_revision = null where id = pg_temp.plan_id();
select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select throws_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'P0001', 'no_time_to_extend',
  'a deadline already at the cut-off has nothing to give, and says so rather than saving a no-op'
);

select pg_temp.act_as_postgres();
select throws_ok(
  format($$ update public.plans set deadline_extended_on_revision = 9 where id = %L $$, pg_temp.plan_id()),
  '23514', null,
  'a spent extension can only name a revision the plan has reached'
);

-- Put the plan back to a week out, replies closed, for the rest.
update public.plans set revision = 1, deadline_extended_on_revision = null,
  window_start = (now() + interval '6 days')::date, window_end = (now() + interval '9 days')::date,
  daily_start_local = 1050, daily_end_local = 1350,
  response_deadline = now() - interval '2 hours'
where id = pg_temp.plan_id();

-- ---------------------------------------------------------------------------
-- Hand this to someone else: hand_off_organiser
-- ---------------------------------------------------------------------------

-- Letters already written to Maya, which a hand-off has to take back, and one
-- to Priya about something else, which it must leave alone.
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('00000000-0000-0000-0000-0000000024a1', 'maya-rc@example.com', 'verified', now()),
       ('00000000-0000-0000-0000-0000000024a2', 'priya-rc@example.com', 'verified', now());

insert into jobs.notification_jobs (
  channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key, status
)
select 'email', k.kind, c.id, pg_temp.plan_id(), 1, now() + interval '8 hours', k.key, 'scheduled'
from (values ('replies_closed', 'maya-rc@example.com', '0000000000000000000000000000000000000000000000000000000000000001'),
             ('options_ready', 'maya-rc@example.com', '0000000000000000000000000000000000000000000000000000000000000002'),
             ('replies_closed', 'priya-rc@example.com', '0000000000000000000000000000000000000000000000000000000000000003')) as k (kind, addr, key)
join private.email_contacts c on c.email_normalized = k.addr;

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a2');
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a3'),
  'P0001', 'not_the_organiser',
  'a member cannot give away a plan that is not theirs'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a4'),
  'P0001', 'requires_saved_place',
  'a guest cannot be handed it: organiser roles belong to saved places (spec §8.2)'
);
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a5'),
  'P0001', 'not_a_member',
  'nor somebody who has left the circle'
);
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a6'),
  'P0001', 'not_a_participant',
  'nor a member the plan never asked, whom its letters could not reach'
);
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a1'),
  'P0001', 'already_the_organiser',
  'nor the organiser themselves'
);
select throws_ok(
  format($$ select public.hand_off_organiser(%L, null) $$, pg_temp.plan_id()),
  'P0001', 'not_a_member',
  'nor nobody'
);
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, '00000000-0000-0000-0000-00000000dead',
    '00000000-0000-0000-0000-0000000024a2'),
  'P0001', 'plan_not_found',
  'and a plan that is not there is not found'
);

select pg_temp.act_as_postgres();
select is(
  (select organiser_user_id from public.plans where id = pg_temp.plan_id()),
  '00000000-0000-0000-0000-0000000024a1'::uuid,
  'none of those refusals moved anything'
);
select is(
  (select count(*)::integer from jobs.notification_jobs
   where plan_id = pg_temp.plan_id() and status = 'scheduled'),
  3,
  'or took any letter back'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select lives_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a2'),
  'the organiser hands it to Priya'
);

select pg_temp.act_as_postgres();
select is(
  (select organiser_user_id::text || '/' || state || '/' || revision from public.plans where id = pg_temp.plan_id()),
  '00000000-0000-0000-0000-0000000024a2/ready/1',
  'Priya organises it now, and nothing else about the plan moved'
);
select ok(
  exists (
    select 1 from jobs.outbox o
    where o.event_name = 'planning.organiser_changed' and o.aggregate_id = pg_temp.plan_id()
      and o.payload ->> 'organiser_user_id' = '00000000-0000-0000-0000-0000000024a2'
      and o.payload ->> 'action' = 'hand_off'
  ),
  'announced as planning.organiser_changed, naming the new organiser'
);
select is(
  (select string_agg(j.kind || ':' || j.status || ':' || coalesce(j.last_error, '-'), ',' order by j.idempotency_key)
   from jobs.notification_jobs j where j.plan_id = pg_temp.plan_id()),
  'replies_closed:skipped:organiser_changed,options_ready:skipped:organiser_changed,replies_closed:scheduled:-',
  'Maya''s queued letters are taken back in the same transaction, and nobody else''s are touched'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a3'),
  'P0001', 'not_the_organiser',
  'and Maya cannot hand on what she has already handed over'
);
select throws_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'P0001', 'not_the_organiser',
  'or extend it'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a2');
select lives_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'while Priya, who organises it now, can'
);

-- A hand-off is for a plan that is still to be decided.
select pg_temp.act_as_postgres();
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'confirmed' where id = pg_temp.plan_id();
select pg_temp.act_as('00000000-0000-0000-0000-0000000024a2');
select throws_ok(
  format($$ select public.hand_off_organiser(%L, %L) $$, pg_temp.plan_id(),
    '00000000-0000-0000-0000-0000000024a3'),
  'P0001', 'wrong_state',
  'a locked-in plan is not handed off from here'
);
select throws_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'P0001', 'wrong_state',
  'nor given another day'
);
select pg_temp.act_as_postgres();
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'cancelled' where id = pg_temp.plan_id();
select pg_temp.act_as('00000000-0000-0000-0000-0000000024a2');
select throws_ok(
  format($$ select public.extend_deadline(%L) $$, pg_temp.plan_id()),
  'P0001', 'plan_is_finished',
  'and a finished one says it is finished'
);
select pg_temp.act_as_postgres();
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'ready', deadline_extended_on_revision = null,
  response_deadline = now() - interval '2 hours'
where id = pg_temp.plan_id();

-- The transition table and the domain agree on the new action.
select results_eq(
  $$ select from_state, to_state, guards from planning.transitions
     where action = 'hand_off' order by from_state $$,
  $$ values ('collecting'::text, 'collecting'::text, array['organiser','hand_off_target']::text[]),
            ('ready', 'ready', array['organiser','hand_off_target']) $$,
  'hand_off exists from collecting and ready, guarded organiser and hand_off_target'
);
select is(planning.event_for('ready', 'hand_off'), 'planning.organiser_changed',
  'and announces planning.organiser_changed');
select is(planning.allowed_keys('hand_off'), array['organiser_user_id'],
  'carrying the new organiser and nothing else');

-- ---------------------------------------------------------------------------
-- The letters: once per deadline, once more a day later while still ready
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select public.dispatch_timed_work(200);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.plan_id()),
  1,
  'the closed deadline is announced'
);

select pg_temp.act_as_service();
select public.dispatch_timed_work(200);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.plan_id()
     and o.payload ? 'follow_up'),
  0,
  'and no follow-up until a day has passed since the first letter'
);

-- A day later.
update jobs.outbox set occurred_at = now() - interval '25 hours'
where event_name = 'planning.deadline_passed' and aggregate_id = pg_temp.plan_id();

select pg_temp.act_as_service();
select is((public.dispatch_timed_work(200) ->> 'followed_up')::integer >= 1, true,
  'a day on, the sweep says it followed up');
select public.dispatch_timed_work(200);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.plan_id()
     and o.payload ->> 'follow_up' = '+24h'),
  1,
  'once: the follow-up is its own marker, and a second sweep adds nothing'
);
select ok(
  (select (o.payload ->> 'deadline')::timestamptz = p.response_deadline
   from jobs.outbox o join public.plans p on p.id = o.aggregate_id
   where o.event_name = 'planning.deadline_passed' and o.aggregate_id = pg_temp.plan_id()
     and o.payload ? 'follow_up'),
  'and it names the deadline it follows up, to the microsecond, as the first does'
);

-- Decided in the meantime: no follow-up. A fresh deadline on the same plan,
-- announced a day ago, then locked in.
update public.plans set response_deadline = now() - interval '26 hours' where id = pg_temp.plan_id();
select pg_temp.act_as_service();
select public.dispatch_timed_work(200);
select pg_temp.act_as_postgres();
update jobs.outbox set occurred_at = now() - interval '25 hours'
where event_name = 'planning.deadline_passed' and aggregate_id = pg_temp.plan_id()
  and (payload ->> 'deadline')::timestamptz = (select response_deadline from public.plans where id = pg_temp.plan_id());
select is(
  (select count(*)::integer from jobs.outbox o join public.plans p on p.id = o.aggregate_id
   where o.event_name = 'planning.deadline_passed' and p.id = pg_temp.plan_id()
     and (o.payload ->> 'deadline')::timestamptz = p.response_deadline and not (o.payload ? 'follow_up')),
  1,
  'the second deadline was announced in its turn'
);
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'collecting' where id = pg_temp.plan_id();
select pg_temp.act_as_service();
select public.dispatch_timed_work(200);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o join public.plans p on p.id = o.aggregate_id
   where o.event_name = 'planning.deadline_passed' and p.id = pg_temp.plan_id()
     and (o.payload ->> 'deadline')::timestamptz = p.response_deadline and o.payload ? 'follow_up'),
  0,
  'a plan no longer ready with an option waiting is not followed up'
);

-- More than a day late: not sent at all rather than sent stale.
select set_config('circles.in_transition', 'on', true);
update public.plans set state = 'ready' where id = pg_temp.plan_id();
update jobs.outbox set occurred_at = now() - interval '49 hours'
where event_name = 'planning.deadline_passed' and aggregate_id = pg_temp.plan_id();
select pg_temp.act_as_service();
select public.dispatch_timed_work(200);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.outbox o join public.plans p on p.id = o.aggregate_id
   where o.event_name = 'planning.deadline_passed' and p.id = pg_temp.plan_id()
     and (o.payload ->> 'deadline')::timestamptz = p.response_deadline and o.payload ? 'follow_up'),
  0,
  'and a follow-up more than a day overdue is dropped, so a deploy does not remind every stale plan'
);

-- ---------------------------------------------------------------------------
-- A second replies_closed is not a duplicate of the first
-- ---------------------------------------------------------------------------
insert into jobs.notification_jobs (
  channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key, status, sent_at
)
select 'email', 'replies_closed', c.id, pg_temp.plan_id(), 1, now() - interval '1 minute', k.key, k.status,
  case when k.status = 'sent' then now() end
from (values ('0000000000000000000000000000000000000000000000000000000000000011', 'sent'), ('0000000000000000000000000000000000000000000000000000000000000012', 'scheduled')) as k (key, status)
cross join private.email_contacts c where c.email_normalized = 'priya-rc@example.com';

select pg_temp.act_as_service();
select is(
  (select (j ->> 'superseded')::boolean
   from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'idempotency_key' = '0000000000000000000000000000000000000000000000000000000000000012'),
  false,
  'the letter for a second deadline, to the same address on the same revision, is not superseded by the first'
);

-- The rule it was carved out of still holds for the kinds it is about.
select pg_temp.act_as_postgres();
insert into jobs.notification_jobs (
  channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key, status, sent_at
)
select 'email', 'options_ready', c.id, pg_temp.plan_id(), 1, now() - interval '1 minute', k.key, k.status,
  case when k.status = 'sent' then now() end
from (values ('0000000000000000000000000000000000000000000000000000000000000021', 'sent'), ('0000000000000000000000000000000000000000000000000000000000000022', 'scheduled')) as k (key, status)
cross join private.email_contacts c where c.email_normalized = 'priya-rc@example.com';
select pg_temp.act_as_service();
select is(
  (select (j ->> 'superseded')::boolean
   from jsonb_array_elements(public.dispatch_claim_due(200)) j
   where j ->> 'idempotency_key' = '0000000000000000000000000000000000000000000000000000000000000022'),
  true,
  'while a second options_ready on one revision is still one letter'
);

-- ---------------------------------------------------------------------------
-- A newer replies_closed takes the place of one still held (review round 1)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into jobs.notification_jobs (
  channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key, status
)
select 'email', 'replies_closed', c.id, pg_temp.plan_id(), 1, now() + interval '8 hours', k.key, 'scheduled'
from (values ('0000000000000000000000000000000000000000000000000000000000000031'),
             ('0000000000000000000000000000000000000000000000000000000000000032')) as k (key)
cross join private.email_contacts c where c.email_normalized = 'priya-rc@example.com';

select ok(
  not has_function_privilege('authenticated', 'public.dispatch_supersede_closing(uuid, text[])', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_supersede_closing(uuid, text[])', 'execute'),
  'nobody but the service role takes letters back'
);
select pg_temp.act_as_service();
select is(
  public.dispatch_supersede_closing(pg_temp.plan_id(),
    array['0000000000000000000000000000000000000000000000000000000000000032']),
  3,
  'every held replies_closed but the one being written is taken back: Priya''s two from earlier and the new older one'
);
select pg_temp.act_as_postgres();
select is(
  (select status || '/' || coalesce(last_error, '-') from jobs.notification_jobs
   where idempotency_key = '0000000000000000000000000000000000000000000000000000000000000031'),
  'skipped/superseded',
  'as superseded'
);
select is(
  (select status from jobs.notification_jobs
   where idempotency_key = '0000000000000000000000000000000000000000000000000000000000000032'),
  'scheduled',
  'and the one it keeps stays queued, so a re-drained event cannot take back its own letter'
);
select is(
  (select status from jobs.notification_jobs
   where idempotency_key = '0000000000000000000000000000000000000000000000000000000000000021'),
  'sent',
  'a letter already sent, and any other kind, is left alone'
);

select * from finish();
rollback;
