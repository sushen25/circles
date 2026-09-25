-- The quiet ask's backend (SUS-50, S2-02; ADR 0035).
--
-- `create_quiet_ask`, `record_interest`, `accept_organiser`, the held ask and
-- its two ways out, the expiry sweep and the dispatcher's audience read —
-- each allowed, and each refused for every reason it has, as the role that
-- would call it. The rules are the domain's (`packages/domain/src/planning/
-- quiet*.ts`); what is proved here is that the database, which is the
-- authority, says the same thing in the same order.
--
-- Sunday Crew: Maya owns it; Priya, Tom, Jess and Sam have saved places; Alex
-- is a guest. Six active members, so the threshold is three. Kai is in no
-- circle of theirs and owns one of his own with nobody else in it.

begin;
select plan(68);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid
language sql
as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous,
    jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'),
    now(), now()
  )
  returning id;
$$;

create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text,
    true
  );
end;
$$;

create or replace function pg_temp.act_as_postgres()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.events_since(mark bigint)
returns table (event_name text, aggregate_id uuid, payload jsonb)
language sql security definer as $$
  select o.event_name, o.aggregate_id, o.payload from jobs.outbox o where o.seq > mark order by o.seq;
$$;
create or replace function pg_temp.mark() returns bigint language sql security definer as $$
  select coalesce(max(seq), 0) from jobs.outbox;
$$;

-- A circle owned by `owner`, made as them, with `others` added as members.
create or replace function pg_temp.circle(owner uuid, key text, others uuid[] default '{}')
returns uuid
language plpgsql
as $$
declare
  made uuid;
begin
  perform pg_temp.act_as(owner);
  select id into made from public.create_circle('Circle ' || key, 'sky', 'Australia/Melbourne', key);
  perform pg_temp.act_as_postgres();
  insert into public.circle_members (circle_id, user_id, display_name_snapshot)
  select made, o, 'Member ' || left(o::text, 4) || right(o::text, 4) from unnest(others) o;
  return made;
end;
$$;

-- A quiet ask as the current role. The window is the next seven days of a
-- week in 2099: evenings, two hours, so the last possible start is Sunday
-- 20 September at 8:30 pm in Melbourne — 10:30 UTC.
create or replace function pg_temp.ask(
  circle uuid,
  stop timestamptz default timestamptz '2099-09-15T00:00:00Z'
)
returns uuid
language sql
as $$
  select id from public.create_quiet_ask(
    circle, 'Catch up', 'catch_up', date '2099-09-14', date '2099-09-20',
    1050, 1350, 120, 'next_7_days', stop
  );
$$;

create or replace function pg_temp.answer(plan uuid, who uuid, keen boolean)
returns boolean
language sql
as $$
  select (public.record_interest(plan, who, keen, timestamptz '2099-09-16T09:00:00Z') ->> 'threshold_reached')::boolean;
$$;

select pg_temp.make_user('24000000-0000-0000-0000-0000000000a1', 'Maya');
select pg_temp.make_user('24000000-0000-0000-0000-0000000000a2', 'Priya');
select pg_temp.make_user('24000000-0000-0000-0000-0000000000a3', 'Tom');
select pg_temp.make_user('24000000-0000-0000-0000-0000000000a4', 'Jess');
select pg_temp.make_user('24000000-0000-0000-0000-0000000000a5', 'Sam');
select pg_temp.make_user('24000000-0000-0000-0000-0000000000a6', 'Alex', true);
select pg_temp.make_user('24000000-0000-0000-0000-0000000000a7', 'Kai');
select pg_temp.make_user('24000000-0000-0000-0000-0000000000a8', 'Olga');

select pg_temp.circle('24000000-0000-0000-0000-0000000000a1', 'q-crew', array[
  '24000000-0000-0000-0000-0000000000a2', '24000000-0000-0000-0000-0000000000a3',
  '24000000-0000-0000-0000-0000000000a4', '24000000-0000-0000-0000-0000000000a5',
  '24000000-0000-0000-0000-0000000000a6'
]::uuid[]) as crew \gset
select pg_temp.circle('24000000-0000-0000-0000-0000000000a7', 'q-solo') as solo \gset
select pg_temp.circle('24000000-0000-0000-0000-0000000000a1', 'q-pair', array[
  '24000000-0000-0000-0000-0000000000a2'
]::uuid[]) as pair \gset

-- ---------------------------------------------------------------------------
-- Asking.
-- ---------------------------------------------------------------------------

select pg_temp.mark() as m_ask \gset
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a1');
select pg_temp.ask(:'crew') as q1 \gset
select pg_temp.act_as_postgres();

select is(
  (select array[state, quiet_threshold::text, quiet_preset] from public.plans where id = :'q1'),
  array['seeking', '3', 'next_7_days'],
  'a quiet ask is seeking, with the threshold for six members and the preset it was made with'
);
select ok(
  (select organiser_user_id is null from public.plans where id = :'q1'),
  'and nobody organises it'
);
select is(
  (select initiator_user_id from private.plan_initiators where plan_id = :'q1'),
  '24000000-0000-0000-0000-0000000000a1'::uuid,
  'who asked is recorded privately'
);
select is(
  (select array_agg(user_id::text || ':' || response) from private.plan_interest where plan_id = :'q1'),
  array['24000000-0000-0000-0000-0000000000a1:keen'],
  'and the initiator is keen from the start, through an ordinary interest row'
);
select is(
  (select count(*)::integer from public.plan_required_members where plan_id = :'q1'),
  0,
  'nobody is required: the only candidate would be the initiator, on a table the circle reads'
);
select is(
  (select count(*)::integer from public.plan_participants where plan_id = :'q1'),
  6,
  'the whole circle is asked, the initiator among them'
);
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m_ask')),
  array['planning.quiet_ask_created'],
  'asking announces the ask'
);
select ok(
  not exists (
    select 1 from pg_temp.events_since(:'m_ask')
    where payload::text like '%24000000-0000-0000-0000-0000000000a1%'
  ),
  'and names nobody'
);

select pg_temp.act_as('24000000-0000-0000-0000-0000000000a1');
select throws_ok(
  format($$select pg_temp.ask('%s')$$, :'crew'),
  'P0001', 'already_asking',
  'one open ask per member per circle'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a6', true);
select throws_ok(
  format($$select pg_temp.ask('%s')$$, :'crew'),
  'P0001', 'requires_saved_place',
  'a guest cannot ask quietly'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a7');
select throws_ok(
  format($$select pg_temp.ask('%s')$$, :'crew'),
  'P0001', 'not_a_member',
  'nor can somebody outside the circle'
);
select throws_ok(
  format($$select pg_temp.ask('%s')$$, :'solo'),
  'P0001', 'nobody_to_ask',
  'a circle of one has nobody to ask'
);

select pg_temp.act_as_postgres();
update public.circle_members set muted_quiet_asks = true
where circle_id = :'crew' and user_id = '24000000-0000-0000-0000-0000000000a5';
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a5');
select throws_ok(
  format($$select pg_temp.ask('%s')$$, :'crew'),
  'P0001', 'quiet_asks_muted',
  'somebody who has muted quiet asks is told that, and not that others exist'
);
select pg_temp.act_as_postgres();
update public.circle_members set muted_quiet_asks = false
where circle_id = :'crew' and user_id = '24000000-0000-0000-0000-0000000000a5';

select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select throws_ok(
  format($$select pg_temp.ask('%s', now() - interval '1 minute')$$, :'crew'),
  'P0001', 'stop_time_unavailable',
  'a stop time already passed is refused'
);
select throws_ok(
  format($$select pg_temp.ask('%s', timestamptz '2099-09-20T10:30:00Z')$$, :'crew'),
  '23514', 'stop_time_unavailable',
  'and so is one at the last possible start: it has to stop strictly before'
);

select pg_temp.ask(:'crew') as q2 \gset
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a3');
select pg_temp.ask(:'crew') as q3 \gset
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a4');
select throws_ok(
  format($$select pg_temp.ask('%s')$$, :'crew'),
  'P0001', 'circle_ask_limit',
  'three asks in a circle in seven days is the limit, whoever asks'
);

-- The pair: a named plan finding a time holds the circle (ADR 0033).
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a1');
select id as named from public.create_plan(
  :'pair', 'Dinner', 'dinner', date '2099-09-14', date '2099-09-20', 1050, 1350, 120,
  null, timestamptz '2099-09-15T00:00:00Z'
) \gset
select throws_ok(
  format($$select pg_temp.ask('%s')$$, :'pair'),
  'P0001', 'plan_in_progress',
  'a quiet ask cannot start beside a plan finding a time, by the machine''s own guard'
);
select public.cancel_plan(:'named');
select pg_temp.ask(:'pair') as qpair \gset
select pg_temp.act_as_postgres();
select is(
  (select quiet_threshold from public.plans where id = :'qpair'),
  2,
  'a circle of two needs both of them'
);

-- Thirteen members need four (ADR 0035).
do $$
declare
  i integer;
begin
  for i in 1..12 loop
    perform pg_temp.make_user(('24000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'M' || i);
  end loop;
end $$;
select pg_temp.circle('24000000-0000-0000-0000-000000000101', 'q-thirteen', array(
  select ('24000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid
  from generate_series(2, 12) i
) || '24000000-0000-0000-0000-0000000000a7'::uuid) as thirteen \gset
select pg_temp.act_as('24000000-0000-0000-0000-000000000101');
select pg_temp.ask(:'thirteen') as q13 \gset
select pg_temp.act_as_postgres();
select is(
  (select quiet_threshold from public.plans where id = :'q13'),
  4,
  'thirteen members need four keen'
);

-- ---------------------------------------------------------------------------
-- Answering, and the one crossing.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select throws_ok(
  format($$select public.record_interest('%s', '24000000-0000-0000-0000-0000000000a2', true, null)$$, :'q1'),
  '42501', null,
  'a client cannot record interest directly: the deadline an opening ask gets is not theirs to say'
);
select pg_temp.act_as_postgres();

select throws_ok(
  format($$select pg_temp.answer('%s', '24000000-0000-0000-0000-0000000000a7', true)$$, :'q1'),
  'P0001', 'plan_not_found',
  'somebody outside the circle is told there is no such plan'
);
select throws_ok(
  format($$select pg_temp.answer('%s', '24000000-0000-0000-0000-0000000000a2', true)$$, :'named'),
  'P0001', 'not_quiet',
  'a named plan has no interest to record'
);
select throws_ok(
  format($$select pg_temp.answer('%s', '24000000-0000-0000-0000-0000000000a1', false)$$, :'q1'),
  'P0001', 'initiator_is_keen',
  'the initiator stays keen; to stop, they withdraw'
);
select is(pg_temp.answer(:'q1', '24000000-0000-0000-0000-0000000000a2', true), false,
  'two keen of three: recorded, not open');
select is(pg_temp.answer(:'q1', '24000000-0000-0000-0000-0000000000a3', false), false,
  '"not this time" counts for nothing');
select is(pg_temp.answer(:'q1', '24000000-0000-0000-0000-0000000000a3', false), false,
  'and a repeat is not an error');

select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select is(
  (select count(*)::integer from public.plan_interest_counts where plan_id = :'q1'),
  0,
  'while it asks there is no count to read'
);
select pg_temp.act_as_postgres();

select pg_temp.mark() as m_cross \gset
select is(pg_temp.answer(:'q1', '24000000-0000-0000-0000-0000000000a4', true), true,
  'the third keen answer opens it');
select is(
  (select array[state, response_deadline::text] from public.plans where id = :'q1'),
  array['collecting', (timestamptz '2099-09-16T09:00:00Z')::text],
  'into collecting, with the deadline the domain gave it for this moment'
);
select is(
  (select array_agg(event_name) from pg_temp.events_since(:'m_cross')),
  array['planning.threshold_reached'],
  'announced once'
);
select ok(
  not exists (select 1 from pg_temp.events_since(:'m_cross') where payload::text like '%24000000-%'),
  'with the keen count and no member id'
);
select throws_ok(
  format($$select pg_temp.answer('%s', '24000000-0000-0000-0000-0000000000a5', true)$$, :'q1'),
  'P0001', 'interest_closed',
  'once open, interest is closed'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select is(
  (select keen_count from public.plan_interest_counts where plan_id = :'q1'),
  3,
  'and the count is the one it opened with'
);
select pg_temp.act_as_postgres();

-- Held: Priya's ask reaches three while Maya's is finding a time.
select pg_temp.answer(:'q2', '24000000-0000-0000-0000-0000000000a1', true);
select is(pg_temp.answer(:'q2', '24000000-0000-0000-0000-0000000000a3', true), false,
  'an ask at its threshold beside an open plan does not open');
select is(
  (select state from public.plans where id = :'q2'),
  'seeking',
  'it is held, still seeking, and its answers are kept'
);
select ok(
  not (select (public.dispatch_timed_work(50) -> 'held') @> to_jsonb(array[jsonb_build_object('id', :'q2')])),
  'nor does the sweep offer it while the circle is busy'
);

-- ---------------------------------------------------------------------------
-- Taking the role.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('24000000-0000-0000-0000-0000000000a3');
select throws_ok(
  format($$select public.accept_organiser('%s')$$, :'q3'),
  'P0001', 'wrong_state',
  'nobody organises an ask still gathering interest'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a6', true);
select throws_ok(
  format($$select public.accept_organiser('%s')$$, :'q1'),
  'P0001', 'requires_saved_place',
  'a guest cannot take the role'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a3');
select throws_ok(
  format($$select public.accept_organiser('%s')$$, :'q1'),
  'P0001', 'not_keen',
  'nor can somebody who said not this time'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a5');
select throws_ok(
  format($$select public.accept_organiser('%s')$$, :'q1'),
  'P0001', 'not_keen',
  'nor somebody who never answered'
);
select pg_temp.act_as_postgres();
select pg_temp.mark() as m_accept \gset
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select is(
  (select organiser_user_id from public.accept_organiser(:'q1')),
  '24000000-0000-0000-0000-0000000000a2'::uuid,
  'a keen member volunteers and is the organiser'
);
select pg_temp.act_as_postgres();
select is(
  (select array_agg(k order by k) from pg_temp.events_since(:'m_accept'), jsonb_object_keys(payload) k
   where event_name = 'planning.organiser_accepted'),
  array['action', 'circle_id', 'from_state', 'mode', 'organiser_user_id', 'plan_id', 'revision', 'to_state'],
  'announced with the organiser and never how they came to it'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a4');
select throws_ok(
  format($$select public.accept_organiser('%s')$$, :'q1'),
  'P0001', 'already_taken',
  'the first to accept wins'
);

-- The owner's fallback waits for replies to close. Olga owns a circle of four
-- and is not keen; Priya asks, Tom and Jess are keen.
select pg_temp.act_as_postgres();
select pg_temp.circle('24000000-0000-0000-0000-0000000000a8', 'q-olga', array[
  '24000000-0000-0000-0000-0000000000a2', '24000000-0000-0000-0000-0000000000a3',
  '24000000-0000-0000-0000-0000000000a4'
]::uuid[]) as olga \gset
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select pg_temp.ask(:'olga') as qolga \gset
select pg_temp.act_as_postgres();
select pg_temp.answer(:'qolga', '24000000-0000-0000-0000-0000000000a3', true);
select pg_temp.answer(:'qolga', '24000000-0000-0000-0000-0000000000a4', true);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a8');
select throws_ok(
  format($$select public.accept_organiser('%s')$$, :'qolga'),
  'P0001', 'deadline_not_passed',
  'the owner who is not keen waits until replies close'
);
select pg_temp.act_as_postgres();
update public.plans set response_deadline = now() - interval '1 minute' where id = :'qolga';
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a8');
select is(
  (select organiser_user_id from public.accept_organiser(:'qolga')),
  '24000000-0000-0000-0000-0000000000a8'::uuid,
  'and then may take it'
);

-- ---------------------------------------------------------------------------
-- Withdrawing: `cancel-plan`, silently.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();
select pg_temp.mark() as m_withdraw \gset
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a3');
select is(
  (select state from public.cancel_plan(:'q3')),
  'cancelled',
  'the initiator withdraws through the ordinary cancel'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from pg_temp.events_since(:'m_withdraw')),
  0,
  'and nobody is told, because there is no event to tell them from'
);

-- ---------------------------------------------------------------------------
-- The held ask's two ways out, and the stop time.
-- ---------------------------------------------------------------------------

-- Maya's opened plan is called off by its organiser; the circle is free.
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select public.cancel_plan(:'q1');
select pg_temp.act_as_postgres();
select ok(
  (select (public.dispatch_timed_work(50) -> 'held') @> to_jsonb(array[jsonb_build_object('id', :'q2')])),
  'the sweep names the held ask once its circle is free'
);
select is(public.dispatch_open_quiet_ask(:'q2', timestamptz '2099-09-16T09:00:00Z'), true,
  'and it opens when the dispatcher tries again');
select is(
  (select state from public.plans where id = :'q2'),
  'collecting',
  'into collecting'
);
select is(public.dispatch_open_quiet_ask(:'q2', timestamptz '2099-09-16T09:00:00Z'), false,
  'once: a second attempt finds nothing to open');

-- The pair's ask reaches its stop time with only Maya keen.
update public.plans set quiet_expires_at = now() - interval '1 minute' where id = :'qpair';
select throws_ok(
  format($$select pg_temp.answer('%s', '24000000-0000-0000-0000-0000000000a2', true)$$, :'qpair'),
  'P0001', 'interest_closed',
  'from its stop time an ask takes no answers, even before the sweep'
);
select is(public.dispatch_open_quiet_ask(:'qpair', timestamptz '2099-09-16T09:00:00Z'), false,
  'and does not open');
select pg_temp.mark() as m_expire \gset
select ok(
  (select (public.dispatch_timed_work(50) ->> 'quiet_expired')::integer >= 1),
  'the sweep expires it'
);
select is(
  (select state from public.plans where id = :'qpair'),
  'expired',
  'privately'
);
select is(
  (select payload ->> 'from_state' from pg_temp.events_since(:'m_expire')
   where event_name = 'planning.plan_expired' and aggregate_id = :'qpair'),
  'seeking',
  'and the event says it never opened, which is how the initiator''s notice is addressed'
);

-- ---------------------------------------------------------------------------
-- What a viewer may know about themselves (`my_quiet_ask`, for `quietView`).
-- ---------------------------------------------------------------------------

select pg_temp.act_as('24000000-0000-0000-0000-0000000000a1');
select is(
  public.my_quiet_ask(:'qpair'),
  jsonb_build_object('is_initiator', true, 'my_answer', 'keen', 'ever_opened', false),
  'the initiator of an ask that closed quietly learns it was theirs and never opened'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select is(
  public.my_quiet_ask(:'qpair'),
  jsonb_build_object('is_initiator', false, 'my_answer', null, 'ever_opened', false),
  'anybody else learns only about themselves'
);
select is(
  public.my_quiet_ask(:'q2'),
  jsonb_build_object('is_initiator', true, 'my_answer', 'keen', 'ever_opened', null),
  'and an ask still running has no history to tell'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a7');
select is(
  public.my_quiet_ask(:'q2'),
  null,
  'somebody outside the circle learns nothing'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a1');
select is(
  public.my_quiet_ask(:'named'),
  null,
  'nor is there anything to say about a named plan'
);
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- Who a quiet message is for, read only for the kind that needs it.
-- ---------------------------------------------------------------------------

select is(
  public.dispatch_quiet_audience(:'q2', 'threshold_keen'),
  jsonb_build_object(
    'initiator_user_id', '24000000-0000-0000-0000-0000000000a2',
    'keen_user_ids', jsonb_build_array(
      '24000000-0000-0000-0000-0000000000a1', '24000000-0000-0000-0000-0000000000a2',
      '24000000-0000-0000-0000-0000000000a3')
  ),
  'the keen members, and the initiator to leave out of their message'
);
select is(
  public.dispatch_quiet_audience(:'q2', 'quiet_expired'),
  jsonb_build_object('initiator_user_id', '24000000-0000-0000-0000-0000000000a2', 'keen_user_ids', '[]'::jsonb),
  'the initiator alone for their own notice'
);
select is(
  public.dispatch_quiet_audience(:'q2', 'new_plan'),
  jsonb_build_object('initiator_user_id', null, 'keen_user_ids', '[]'::jsonb),
  'and nothing at all for any other kind'
);
select pg_temp.act_as('24000000-0000-0000-0000-0000000000a2');
select throws_ok(
  format($$select public.dispatch_quiet_audience('%s', 'threshold_keen')$$, :'q2'),
  '42501', null,
  'which no client may call'
);
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- The shape (0026).
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.plans (
      circle_id, mode, state, title, time_zone, window_start, window_end,
      daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline,
      short_code, quiet_threshold, quiet_preset
    ) values ('%s', 'quiet', 'seeking', 'No stop', 'Australia/Melbourne',
      date '2099-09-14', date '2099-09-20', 1050, 1350, 120, 2,
      timestamptz '2099-09-15T00:00:00Z', 'pnqnstp2', 3, 'next_7_days')$$, :'olga'),
  '23514', null,
  'a quiet ask cannot be asking with no stop time'
);
select throws_ok(
  format($$insert into public.plans (
      circle_id, mode, state, title, time_zone, window_start, window_end,
      daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline,
      short_code, quiet_preset
    ) values ('%s', 'named', 'draft', 'Named', 'Australia/Melbourne',
      date '2099-09-14', date '2099-09-20', 1050, 1350, 120, 2,
      timestamptz '2099-09-15T00:00:00Z', 'pnqnamed', 'next_7_days')$$, :'olga'),
  '23514', null,
  'a named plan has no quiet preset'
);
select throws_ok(
  format($$insert into public.plans (
      circle_id, mode, state, organiser_user_id, title, time_zone, window_start, window_end,
      daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline,
      short_code, quiet_threshold, quiet_expires_at, quiet_preset
    ) values ('%s', 'quiet', 'seeking', '24000000-0000-0000-0000-0000000000a8', 'Organised',
      'Australia/Melbourne', date '2099-09-14', date '2099-09-20', 1050, 1350, 120, 2,
      timestamptz '2099-09-15T00:00:00Z', 'pnqrgnd2', 3, timestamptz '2099-09-15T00:00:00Z',
      'next_7_days')$$, :'olga'),
  '23514', null,
  'and nobody organises one while it asks'
);

select * from finish();
rollback;
