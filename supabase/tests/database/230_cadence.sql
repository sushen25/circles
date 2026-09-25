-- Cadence nudges: the database's half (S2-04, migration 0025).
--
-- Whether a nudge is owed, for which due date and to whom is the domain's
-- (`nudgeDueDate`, `nudgeChoice`) and is tested there. What is proved here is
-- what only the database can promise: that the sweep finds a circle that may
-- be due and leaves out the ones that cannot be; that the context carries the
-- last happened meetup's organiser and who was there; that a due date is
-- decided **once**, whoever it goes to; that a plan opened meanwhile wins; that
-- a nudge's job belongs to its circle and to no plan; and that "it's your
-- turn" is told to the one person asked and to nobody else.
--
-- Dates are relative to now: the circle last met twenty-six days ago, so a
-- monthly circle is inside its week's lead whenever this runs.

begin;
select plan(27);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', now(), false, jsonb_build_object('is_anonymous', false),
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

-- Maya owns it and organised last time; Priya and Tom came; Jess did not.
-- Nic is in another circle entirely.
select pg_temp.make_user('00000000-0000-0000-0000-0000000023a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000023a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000023a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000023a4', 'Jess');
select pg_temp.make_user('00000000-0000-0000-0000-0000000023a5', 'Nic');

select pg_temp.act_as('00000000-0000-0000-0000-0000000023a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-cadence', 'monthly');

select pg_temp.act_as_postgres();
create temporary table t as
select id as circle_id,
  ((now() at time zone 'Australia/Melbourne')::date - 26) as met_on
from public.circles where creation_key = 'key-cadence';
grant select on t to anon, authenticated, service_role;
create or replace function pg_temp.circle() returns uuid
language sql security definer as $$ select circle_id from t $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u.id, u.name from t,
  (values ('00000000-0000-0000-0000-0000000023a2'::uuid, 'Priya'),
          ('00000000-0000-0000-0000-0000000023a3'::uuid, 'Tom'),
          ('00000000-0000-0000-0000-0000000023a4'::uuid, 'Jess')) as u (id, name);
update public.circles set nudge_policy = 'take_turns' where id = pg_temp.circle();

-- The last meetup: confirmed twenty-six days ago, everyone but Jess going,
-- Priya said "I was there", and Maya reported that it happened — which is
-- what moves `last_met_at`.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'confirmed', '00000000-0000-0000-0000-0000000023a1',
  'Catch up', 'Australia/Melbourne', met_on, met_on + 3, 1050, 1350, 120, 2,
  (met_on::timestamp) at time zone 'Australia/Melbourne', 'cdnprev'
from t;
insert into public.plan_participants (plan_id, revision, user_id)
select p.id, 1, u from public.plans p, unnest(array[
  '00000000-0000-0000-0000-0000000023a1'::uuid, '00000000-0000-0000-0000-0000000023a2'::uuid,
  '00000000-0000-0000-0000-0000000023a3'::uuid, '00000000-0000-0000-0000-0000000023a4'::uuid
]) as u where p.short_code = 'cdnprev';
insert into public.meetup_confirmations
  (plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by)
select p.id, 1, (t.met_on::timestamp + interval '18 hours 30 minutes')::text,
  (t.met_on::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
  (t.met_on::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
  array['00000000-0000-0000-0000-0000000023a1', '00000000-0000-0000-0000-0000000023a2',
        '00000000-0000-0000-0000-0000000023a3']::uuid[],
  '00000000-0000-0000-0000-0000000023a1'
from public.plans p, t where p.short_code = 'cdnprev';
insert into public.attendance (confirmation_id, user_id, status)
select mc.id, u.id, u.status from public.meetup_confirmations mc
join public.plans p on p.id = mc.plan_id,
  (values ('00000000-0000-0000-0000-0000000023a1'::uuid, 'going'),
          ('00000000-0000-0000-0000-0000000023a2'::uuid, 'going'),
          ('00000000-0000-0000-0000-0000000023a3'::uuid, 'going'),
          ('00000000-0000-0000-0000-0000000023a4'::uuid, 'cant')) as u (id, status)
where p.short_code = 'cdnprev';

select pg_temp.act_as('00000000-0000-0000-0000-0000000023a1');
select public.report_outcome(
  (select mc.id from public.meetup_confirmations mc join public.plans p on p.id = mc.plan_id
   where p.short_code = 'cdnprev'), 'happened');

-- ---------------------------------------------------------------------------
-- The context: who organised, and who came.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();
select is(
  public.dispatch_circle_context(pg_temp.circle()) ->> 'last_organiser_id',
  '00000000-0000-0000-0000-0000000023a1',
  'the last happened meetup''s organiser is the one take turns walks on from'
);
select is(
  public.dispatch_circle_context(pg_temp.circle()) -> 'last_happened_attendees',
  '["00000000-0000-0000-0000-0000000023a1", "00000000-0000-0000-0000-0000000023a2", "00000000-0000-0000-0000-0000000023a3"]'::jsonb,
  'with nobody saying "I was there", who came is everyone who was going'
);
select is(
  (public.dispatch_circle_context(pg_temp.circle()) ->> 'has_open_plan')::boolean,
  false,
  'and with the outcome reported, nothing is open'
);
select is(
  jsonb_array_length(public.dispatch_circle_context(pg_temp.circle()) -> 'members'),
  4,
  'the roster is every membership row'
);
select ok(
  (public.dispatch_circle_context(pg_temp.circle()) -> 'members' -> 0) ? 'muted_nudges',
  'and each carries its nudge switch, which nothing read before this'
);

select pg_temp.act_as_postgres();
update public.attendance a set status = 'was_there'
from public.meetup_confirmations mc join public.plans p on p.id = mc.plan_id
where a.confirmation_id = mc.id and p.short_code = 'cdnprev'
  and a.user_id = '00000000-0000-0000-0000-0000000023a2';
select pg_temp.act_as_service();
select is(
  public.dispatch_circle_context(pg_temp.circle()) -> 'last_happened_attendees',
  '["00000000-0000-0000-0000-0000000023a2"]'::jsonb,
  'once somebody says "I was there", that is the record'
);

-- ---------------------------------------------------------------------------
-- The sweep.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();
select ok(
  public.dispatch_timed_work(200) -> 'cadence' ? pg_temp.circle()::text,
  'a monthly circle that met twenty-six days ago may be due, so the sweep names it'
);

select pg_temp.act_as_postgres();
update public.circles set cadence_snoozed_until = now() + interval '1 month'
where id = pg_temp.circle();
select pg_temp.act_as_service();
select ok(
  not (public.dispatch_timed_work(200) -> 'cadence' ? pg_temp.circle()::text),
  'not while it is snoozed'
);
select pg_temp.act_as_postgres();
update public.circles set cadence_snoozed_until = null, cadence = 'two_monthly'
where id = pg_temp.circle();
select pg_temp.act_as_service();
select ok(
  not (public.dispatch_timed_work(200) -> 'cadence' ? pg_temp.circle()::text),
  'nor when its rhythm is two months and it met under a month ago'
);
select pg_temp.act_as_postgres();
update public.circles set cadence = 'none' where id = pg_temp.circle();
select pg_temp.act_as_service();
select ok(
  not (public.dispatch_timed_work(200) -> 'cadence' ? pg_temp.circle()::text),
  'nor with no goal'
);
select pg_temp.act_as_postgres();
update public.circles set cadence = 'monthly' where id = pg_temp.circle();

-- A plan finding a time.
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select circle_id, 'named', 'collecting', '00000000-0000-0000-0000-0000000023a2',
  'Next one', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'cdnnext'
from t;
select pg_temp.act_as_service();
select ok(
  not (public.dispatch_timed_work(200) -> 'cadence' ? pg_temp.circle()::text),
  'nor while a plan is finding a time'
);
select is(
  public.dispatch_prompt_cadence(pg_temp.circle(), current_date + 5,
    '00000000-0000-0000-0000-0000000023a2', 'take_turns', '[]'::jsonb),
  null,
  'and a decision made while a plan is open writes nothing: a plan made meanwhile wins'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from private.cadence_prompts where circle_id = pg_temp.circle()),
  0,
  'not even the record of the decision'
);
select planning.transition_plan((select id from public.plans where short_code = 'cdnnext'), 'cancel',
  '00000000-0000-0000-0000-0000000023a2');

-- ---------------------------------------------------------------------------
-- The decision, once.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_service();
create temporary table nudge as
select public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000023a2') as contact,
  current_date + 5 as due;
grant select on nudge to anon, authenticated, service_role;

select is(
  public.dispatch_prompt_cadence(pg_temp.circle(), (select due from nudge),
    '00000000-0000-0000-0000-0000000023a2', 'take_turns',
    jsonb_build_array(jsonb_build_object(
      'channel', 'email', 'kind', 'about_time', 'contact_id', (select contact from nudge),
      'circle_id', pg_temp.circle(), 'scheduled_for', now(), 'idempotency_key', repeat('d', 64)))),
  1,
  'the first decision for a due date writes its one job'
);
select is(
  public.dispatch_prompt_cadence(pg_temp.circle(), (select due from nudge),
    '00000000-0000-0000-0000-0000000023a3', 'take_turns',
    jsonb_build_array(jsonb_build_object(
      'channel', 'email', 'kind', 'about_time',
      'contact_id', public.dispatch_organiser_contact('00000000-0000-0000-0000-0000000023a3'),
      'circle_id', pg_temp.circle(), 'scheduled_for', now(), 'idempotency_key', repeat('e', 64)))),
  null,
  'and a second for the same due date writes nothing, even to somebody else'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.notification_jobs
   where circle_id = pg_temp.circle() and kind = 'about_time'),
  1,
  'one job per due date: one person is nudged, never two'
);
select is(
  (select plan_id from jobs.notification_jobs where idempotency_key = repeat('d', 64)),
  null,
  'the nudge belongs to its circle and to no plan'
);
select pg_temp.act_as_service();
select ok(
  not (public.dispatch_timed_work(200) -> 'cadence' ? pg_temp.circle()::text),
  'and a decided circle is not swept again'
);
select is(
  (public.dispatch_circle_context(pg_temp.circle()) ->> 'prompted_for')::date,
  (select due from nudge),
  'the context says which due date is decided'
);

select throws_ok(
  format($$select public.dispatch_prompt_cadence('%s', current_date + 40, null, null,
    '[{"channel":"email","kind":"about_time","contact_id":"%s","circle_id":"%s","scheduled_for":"2099-01-01T00:00:00Z","idempotency_key":"%s"}]'::jsonb)$$,
    pg_temp.circle(), (select contact from nudge), gen_random_uuid(), repeat('f', 64)),
  '23514',
  null,
  'a job for another circle is refused, not quietly written'
);

select pg_temp.act_as_postgres();
select throws_ok(
  format($$insert into jobs.notification_jobs (channel, kind, contact_id, plan_id, scheduled_for, idempotency_key)
    values ('email', 'about_time', '%s', (select id from public.plans where short_code = 'cdnprev'), now(), repeat('a', 64))$$,
    (select contact from nudge)),
  '23514',
  null,
  'a cadence nudge cannot be written against a plan'
);
select throws_ok(
  format($$insert into jobs.notification_jobs (channel, kind, contact_id, plan_id, plan_revision, circle_id, scheduled_for, idempotency_key)
    values ('email', 'locked_in', '%s', (select id from public.plans where short_code = 'cdnprev'), 1, '%s', now(), repeat('b', 64))$$,
    (select contact from nudge), pg_temp.circle()),
  '23514',
  null,
  'and a plan''s kind does not name a circle of its own'
);

-- ---------------------------------------------------------------------------
-- "It's your turn": to the one person asked, and to nobody else.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000023a2');
select ok(public.my_turn_to_plan(pg_temp.circle()), 'Priya, who was asked, is told it is her turn');
select pg_temp.act_as('00000000-0000-0000-0000-0000000023a3');
select ok(not public.my_turn_to_plan(pg_temp.circle()), 'Tom, in the same circle, is not');
select pg_temp.act_as('00000000-0000-0000-0000-0000000023a5');
select ok(not public.my_turn_to_plan(pg_temp.circle()), 'and somebody outside it learns nothing');

select pg_temp.act_as_postgres();
update public.circle_members set muted_nudges = true
where circle_id = pg_temp.circle() and user_id = '00000000-0000-0000-0000-0000000023a2';
select pg_temp.act_as('00000000-0000-0000-0000-0000000023a2');
select ok(
  not public.my_turn_to_plan(pg_temp.circle()),
  'and once Priya turns nudges off, she is not told it is her turn'
);

select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('anon', 'public.my_turn_to_plan(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_circle_context(uuid)', 'execute')
  and not has_function_privilege(
    'authenticated', 'public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb)', 'execute'),
  'the dispatcher''s two are the service role''s alone, and a guest without a session asks nothing'
);

select * from finish();
rollback;
