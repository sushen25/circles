-- The first run drafts before sign-in (SUS-150, ADR 0053).
--
-- The draft lives on the device, so what the database owes the feature is what it
-- always did: nothing is made for somebody without a saved place, and an attempt
-- that is refused leaves no row behind. These pin today's behaviour, which the
-- new order of screens relies on and does not change: an anonymous identity —
-- what a person is before the gate — cannot create a circle or a plan, and
-- walking away from the gate leaves no circle, no membership, no plan and no
-- outbox event behind.

begin;
select plan(8);

create or replace function pg_temp.make_user(id uuid, name text, anonymous boolean default false)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', anonymous, jsonb_build_object('is_anonymous', anonymous),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

create or replace function pg_temp.act_as(id uuid, anonymous boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', anonymous)::text,
    true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select pg_temp.make_user('00000000-0000-0000-0000-00000000d001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000d009', 'Guest', true);

create temp table before_counts as
select
  (select count(*) from public.circles) as circles,
  (select count(*) from public.circle_members) as members,
  (select count(*) from public.plans) as plans,
  (select count(*) from jobs.outbox) as outbox;
grant select on before_counts to authenticated;

-- ---------------------------------------------------------------------------
-- Before the gate: an anonymous identity, which is what the browser has.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000d009', true);

select throws_ok(
  $$select public.create_circle('Draft Crew', 'sky', 'Australia/Melbourne', 'key-draft-1', 'monthly')$$,
  '42501',
  'creating a circle needs a saved place',
  'create_circle still refuses an anonymous session'
);

select is(
  (select count(*)::integer from public.circles where creation_key = 'key-draft-1'),
  0,
  'the refused attempt left no circle'
);

-- ---------------------------------------------------------------------------
-- Abandoning at the gate leaves nothing.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_postgres();

select is(
  (select count(*)::integer from public.circles) - (select circles::integer from before_counts),
  0,
  'no circle after an abandoned draft'
);
select is(
  (select count(*)::integer from public.circle_members) - (select members::integer from before_counts),
  0,
  'no membership after an abandoned draft'
);
select is(
  (select count(*)::integer from public.plans) - (select plans::integer from before_counts),
  0,
  'no plan after an abandoned draft'
);
select is(
  (select count(*)::integer from jobs.outbox) - (select outbox::integer from before_counts),
  0,
  'no outbox event after an abandoned draft'
);

-- ---------------------------------------------------------------------------
-- After the gate: the same two calls, from a saved place, are what the finish makes.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');

select lives_ok(
  $$select public.create_circle('Draft Crew', 'sky', 'Australia/Melbourne', 'key-draft-2', 'monthly')$$,
  'a saved place can create the drafted circle'
);
select is(
  (select (public.create_circle('Draft Crew', 'sky', 'Australia/Melbourne', 'key-draft-2', 'monthly')).id),
  (select id from public.circles where creation_key = 'key-draft-2'),
  'and a resumed finish with the same key returns the same circle, not a second'
);

select * from finish();
rollback;
