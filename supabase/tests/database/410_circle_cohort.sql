-- SUS-178 (ADR 0058): every circle carries a cohort, founder or external
-- (spec §11.4); it is set by a rule at creation and by the founder after, can
-- be read or set by nobody else, and the founder dashboard's gates are counted
-- for each cohort on its own.

begin;
select plan(34);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', false, '{}'::jsonb,
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

create or replace function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Dates are days from the Monday two weeks ago, as in 380_founder_analytics.sql.
create or replace function pg_temp.d(n integer) returns date language sql as $$
  select (date_trunc('week', current_date) - interval '14 days')::date + n
$$;
create or replace function pg_temp.at(n integer, hhmm text) returns timestamptz language sql as $$
  select ((pg_temp.d(n)::text || ' ' || hhmm)::timestamp at time zone 'UTC')
$$;

-- Sam is the founder (on the allowlist). Maya owns an ordinary circle. Nina is
-- in Sam's circle, Tom is in none, Late is made an owner before being allowlisted.
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0001', 'Sam');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0002', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0003', 'Nina');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0004', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0005', 'Late');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0006', 'Ruth');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0007', 'Omar');
insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-0000000c0001');

-- ---------------------------------------------------------------------------
-- The rule at creation.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0001');
select public.create_circle('Founder Test', 'sky', 'Australia/Melbourne', 'key-c-founder');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0002');
select public.create_circle('Real Circle', 'sky', 'Australia/Melbourne', 'key-c-real');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0005');
select public.create_circle('Early Test', 'sky', 'Australia/Melbourne', 'key-c-late');
select pg_temp.act_as_postgres();
create temporary table cs as
select
  (select id from public.circles where creation_key = 'key-c-founder') as f,
  (select id from public.circles where creation_key = 'key-c-real') as r,
  (select id from public.circles where creation_key = 'key-c-late') as l;
grant select on cs to public;

select is(
  (select cohort from private.circle_cohorts where circle_id = (select f from cs)),
  'founder', 'a circle whose owner is on the allowlist is a founder circle'
);
select is(
  (select cohort from private.circle_cohorts where circle_id = (select r from cs)),
  'external', 'any other circle is external'
);
select is(
  (select source from private.circle_cohorts where circle_id = (select f from cs)),
  'default', 'and the row says the rule put it there'
);
insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-0000000c0005');
select is(
  (select cohort from private.circle_cohorts where circle_id = (select l from cs)),
  'external', 'being put on the allowlist afterwards does not move a circle already made'
);
select is(
  (select count(*)::int from public.circles c
   where not exists (select 1 from private.circle_cohorts cc where cc.circle_id = c.id)),
  0, 'every circle has a cohort, the seeded ones included'
);
select is(
  (select count(*)::int from private.circle_cohorts where cohort = 'founder'),
  1, 'and the seed, which has nobody on the allowlist, put none of its circles in the founder cohort'
);

-- ---------------------------------------------------------------------------
-- Nobody but the founder reads or sets it.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and column_name ~* 'cohort'),
  0, 'no table or view in public has a cohort column for a client to read'
);
select ok(
  not has_table_privilege('authenticated', 'private.circle_cohorts', 'select')
  and not has_table_privilege('anon', 'private.circle_cohorts', 'select')
  and not has_table_privilege('service_role', 'private.circle_cohorts', 'select')
  and not has_table_privilege('authenticated', 'private.circle_cohorts', 'update')
  and not has_table_privilege('authenticated', 'private.circle_cohorts', 'insert'),
  'no client role can read or write the mapping'
);
select ok(
  not has_table_privilege('authenticated', 'analytics.circle_cohort', 'select')
  and not has_table_privilege('authenticated', 'analytics.event_cohort', 'select')
  and not has_table_privilege('anon', 'analytics.circle_cohort', 'select'),
  'nor the views that carry it'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.circle_cohorts'::regclass),
  'and row-level security is on, belt and braces'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000c0002');
select throws_ok(
  $$ select cohort from private.circle_cohorts $$,
  '42501', null, 'a circle''s owner cannot read the cohort of their own circle'
);
select throws_ok(
  $$ update private.circle_cohorts set cohort = 'founder' $$,
  '42501', null, 'nor change it'
);
select throws_ok(
  format($$ select public.founder_set_circle_cohort(%L, 'founder') $$, (select r from cs)),
  '42501', 'not_allowed', 'nor through the founder''s function: a signed-in user who is not on the allowlist is refused'
);
select pg_temp.act_as_anon();
select throws_ok(
  format($$ select public.founder_set_circle_cohort(%L, 'founder') $$, (select r from cs)),
  '42501', null, 'and anon is refused'
);
select pg_temp.act_as_postgres();
select is(
  (select cohort from private.circle_cohorts where circle_id = (select r from cs)),
  'external', 'and the refused attempts changed nothing'
);

-- ---------------------------------------------------------------------------
-- The founder sets it.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0001');
select lives_ok(
  format($$ select public.founder_set_circle_cohort(%L, 'founder') $$, (select l from cs)),
  'the allowlisted founder can set a cohort'
);
select throws_ok(
  format($$ select public.founder_set_circle_cohort(%L, 'internal') $$, (select f from cs)),
  '22023', 'invalid_cohort', 'only the two cohorts of spec §11.4 are accepted'
);
select throws_ok(
  $$ select public.founder_set_circle_cohort('00000000-0000-0000-0000-00000000dead', 'founder') $$,
  'P0002', 'circle_not_found', 'and the circle has to exist'
);
select pg_temp.act_as_postgres();
select is(
  (select array[cohort, source] from private.circle_cohorts where circle_id = (select l from cs)),
  array['founder', 'founder'], 'the cohort changed and the row says the founder did it'
);

-- ---------------------------------------------------------------------------
-- The gates, split. Founder Test is made on day 0 and its meetup is confirmed;
-- Real Circle is made the same day and never meets. Nina is in Founder Test.
-- ---------------------------------------------------------------------------
-- The circle the founder just re-labelled is taken out of the scenario's day.
update public.circles set created_at = pg_temp.at(0, '00:00')
where id in ((select f from cs), (select r from cs));
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select f, '00000000-0000-0000-0000-0000000c0003', 'Nina' from cs;

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone, window_start, window_end,
  daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline, short_code, created_at
)
select f, 'named', 'confirmed', '00000000-0000-0000-0000-0000000c0003', 'Catch up', 'Australia/Melbourne',
  pg_temp.d(2), pg_temp.d(5), 1050, 1350, 120, 2,
  (pg_temp.d(3)::timestamp) at time zone 'Australia/Melbourne', 'fapckz', pg_temp.at(0, '01:00')
from cs;
insert into public.plan_participants (plan_id, revision, user_id)
select p.id, 1, u from public.plans p,
  unnest(array['00000000-0000-0000-0000-0000000c0001'::uuid, '00000000-0000-0000-0000-0000000c0003'::uuid]) u
where p.short_code = 'fapckz';
insert into public.meetup_confirmations (
  plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by, status,
  confirmed_at, chased_answer
)
select p.id, 1, 'c1', pg_temp.at(2, '08:00'), pg_temp.at(2, '10:00'),
  array['00000000-0000-0000-0000-0000000c0001'::uuid], '00000000-0000-0000-0000-0000000c0001',
  'active', pg_temp.at(2, '00:00'), 'none'
from public.plans p where p.short_code = 'fapckz';
-- Nina, not the owner, started the plan.
insert into private.audit_log (actor_user_id, action, resource_type, resource_id, occurred_at)
select '00000000-0000-0000-0000-0000000c0003', 'plan.created', 'plan', p.id, p.created_at
from public.plans p where p.short_code = 'fapckz';

-- Events: two with a circle on them (one of each cohort), and two with only a
-- user: Nina is in a founder circle, Tom is in none.
insert into analytics.events (event_id, event_name, schema_version, circle_id, properties, occurred_at)
select gen_random_uuid(), n, 1, c, case when n = 'member_reattached' then '{"source": "list"}'::jsonb else '{}' end,
       pg_temp.at(1, '10:00')
from cs, (values
  ('session_missing_on_return', 'f'), ('session_missing_on_return', 'f'), ('member_reattached', 'f'),
  ('session_missing_on_return', 'r'), ('session_missing_on_return', 'r'), ('session_missing_on_return', 'r'),
  ('member_reattached', 'r'), ('member_reattached', 'r')
) as v (n, which)
cross join lateral (select case v.which when 'f' then cs.f else cs.r end as c) x;
insert into analytics.events (event_id, event_name, schema_version, user_id, properties, occurred_at)
values
  (gen_random_uuid(), 'account_claimed', 1, '00000000-0000-0000-0000-0000000c0003', '{"moment": "after_answer"}', pg_temp.at(1, '11:00')),
  (gen_random_uuid(), 'account_claimed', 1, '00000000-0000-0000-0000-0000000c0004', '{"moment": "after_answer"}', pg_temp.at(1, '11:00'));

select is(
  (select array[circles, confirmed] from analytics.gate_circles_confirm where day = pg_temp.d(0) and cohort = 'founder'),
  array[1::bigint, 1::bigint], 'founder cohort: its one circle that day confirmed a meetup'
);
select is(
  (select array[circles, confirmed] from analytics.gate_circles_confirm where day = pg_temp.d(0) and cohort = 'external'),
  array[1::bigint, 0::bigint], 'external cohort: its one circle that day did not, and is not pooled with the founder''s'
);
select is(
  (select array[members, unchased] from analytics.gate_unchased where day = pg_temp.d(2) and cohort = 'founder'),
  array[2::bigint, 0::bigint], 'a plan''s chasing answer counts in its circle''s cohort (two members asked, none answered)'
);
select is(
  (select count(*)::int from analytics.gate_unchased where day = pg_temp.d(2) and cohort = 'external'),
  0, 'and not in the other'
);
select is(
  (select array[missing, reattached] from analytics.gate_reattach where day = pg_temp.d(1) and cohort = 'founder'),
  array[2::bigint, 1::bigint], 'events that name a circle count in its cohort: founder'
);
select is(
  (select array[missing, reattached] from analytics.gate_reattach where day = pg_temp.d(1) and cohort = 'external'),
  array[3::bigint, 2::bigint], 'and external'
);
select is(
  (select array[claims, elsewhere] from analytics.gate_claim_moments where day = pg_temp.d(1) and cohort = 'founder'),
  array[1::bigint, 1::bigint], 'an event with only a user counts in the cohort of the circles they belong to'
);
-- Ruth was removed from the founder circle and is in Real Circle now; Omar was
-- removed from the founder circle and is in no other.
insert into public.circle_members (circle_id, user_id, display_name_snapshot, status)
select f, '00000000-0000-0000-0000-0000000c0006'::uuid, 'Ruth', 'removed' from cs
union all select r, '00000000-0000-0000-0000-0000000c0006'::uuid, 'Ruth', 'active' from cs
union all select f, '00000000-0000-0000-0000-0000000c0007'::uuid, 'Omar', 'removed' from cs;
insert into analytics.events (event_id, event_name, schema_version, user_id, properties, occurred_at)
values
  (gen_random_uuid(), 'account_claimed', 1, '00000000-0000-0000-0000-0000000c0006', '{"moment": "after_answer"}', pg_temp.at(6, '11:00')),
  (gen_random_uuid(), 'account_claimed', 1, '00000000-0000-0000-0000-0000000c0007', '{"moment": "after_answer"}', pg_temp.at(6, '11:00'));
select is(
  (select array[claims, elsewhere] from analytics.gate_claim_moments where day = pg_temp.d(6) and cohort = 'external'),
  array[1::bigint, 1::bigint], 'a person removed from a founder circle who is in an external one now is external'
);
select is(
  (select array[claims, elsewhere] from analytics.gate_claim_moments where day = pg_temp.d(6) and cohort = 'founder'),
  array[1::bigint, 1::bigint], 'and one removed with no other circle is still placed by the circle they left'
);
select is(
  (select array_agg(cohort order by cohort nulls last) from analytics.gate_claim_moments where day = pg_temp.d(1)),
  array['founder', null], 'and one nobody can place (a user in no circle) is in neither cohort: its row has none'
);

-- What the founder's function returns: each gate once per cohort.
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0001');
create temporary table fa as select public.founder_analytics(pg_temp.d(0)) as j;
select pg_temp.act_as_postgres();
select is(
  (select j -> 'gates' -> 'founder' -> 'confirmed_meetup' from fa),
  '{"numerator": 1, "denominator": 2}'::jsonb,
  'the function returns the founder cohort''s gate over the founder cohort''s two circles (Founder Test, which met, and Early Test) and not Real Circle'
);
select ok(
  (select (j -> 'gates' -> 'external' -> 'confirmed_meetup' ->> 'denominator')::int >= 1
      and (j -> 'gates' -> 'external' -> 'confirmed_meetup' ->> 'numerator')::int
        < (j -> 'gates' -> 'external' -> 'confirmed_meetup' ->> 'denominator')::int from fa),
  'and the external cohort''s over the others, where the founder''s confirmed meetup is not counted'
);
select is(
  (select j -> 'gates' -> 'founder' -> 'other_organiser' from fa),
  '{"count": 1}'::jsonb, 'a plan somebody else started counts in its circle''s cohort'
);
select is(
  (select (j -> 'cohort_circles' ->> 'founder')::int from fa),
  2, 'it says how many circles the founder cohort has (the two re-labelled) and which none'
);
select ok(
  (select not (j::text ~ 'fapckz|Founder Test|Real Circle|Early Test')
      and not (j::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}') from fa),
  'and nothing in the answer names a circle or looks like an id'
);

select * from finish();
rollback;
