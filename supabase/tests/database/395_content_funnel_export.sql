-- SUS-244 (ADR 0087): the content loop's keyed read of the funnel by tag.
--
-- Three things are under test. Who may call it: service_role and nobody else.
-- What it says: counts by tag and the stalled first plans of the `content`
-- source, and nothing finer than that, asserted on the output itself the way
-- 380_founder_analytics.sql does. And that it is one definition with the
-- founder's: the founder's two blocks and the export's agree.

begin;
select plan(21);

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

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Sam is the founder. Maya and Pia own a circle each; Quin owns a third that is
-- not tagged at all.
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0001', 'Sam');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0002', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0004', 'Pia');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e0005', 'Quin');
insert into private.allowlist (user_id) values ('00000000-0000-0000-0000-0000000e0001');

create or replace function pg_temp.make_circle(owner uuid, key text, tag text)
returns void language plpgsql as $$
declare
  made uuid;
begin
  perform pg_temp.act_as(owner);
  made := (public.create_circle('Circle ' || key, 'sky', 'Australia/Melbourne', 'key-' || key)).id;
  if tag is not null then
    perform public.tag_circle_source(made, tag);
  end if;
  perform pg_temp.act_as_postgres();
end;
$$;

select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0002', 'maya', 'ig-never-lead-anywhere');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0004', 'pia', 'rd-profile');
select pg_temp.make_circle('00000000-0000-0000-0000-0000000e0005', 'quin', 'jane-doe-0412555123');

create or replace function pg_temp.make_plan(
  key text, organiser uuid, code text, made interval
) returns uuid language sql as $$
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone, window_start, window_end,
    daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline, short_code, created_at
  ) values (
    (select id from public.circles where creation_key = 'key-' || key),
    'named', 'collecting', organiser, 'Catch up', 'Australia/Melbourne',
    current_date + 1, current_date + 8, 1050, 1350, 120, 2,
    now() + interval '5 days', code, now() - made
  ) returning id;
$$;

-- Maya's owner came from content: her plan, 30 hours old, was never shared.
-- Pia's owner came from reddit: her plan, 60 hours old, was shared 50 hours ago and nobody came.
insert into analytics.events (event_id, event_name, schema_version, user_id, properties, occurred_at)
values
  (gen_random_uuid(), 'organiser_source', 1, '00000000-0000-0000-0000-0000000e0002',
   '{"source": "content"}', now() - interval '3 days'),
  (gen_random_uuid(), 'organiser_source', 1, '00000000-0000-0000-0000-0000000e0004',
   '{"source": "reddit"}', now() - interval '3 days');
select pg_temp.make_plan('maya', '00000000-0000-0000-0000-0000000e0002', 'kmnpq2', interval '30 hours');
select pg_temp.make_plan('pia', '00000000-0000-0000-0000-0000000e0004', 'kmnpq3', interval '60 hours');
insert into analytics.events (event_id, event_name, schema_version, plan_id, properties, occurred_at)
select gen_random_uuid(), 'plan_shared', 1, p.id, '{}', now() - interval '50 hours'
from public.plans p where p.short_code = 'kmnpq3';

-- ---------------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok(
  $$select public.content_funnel_export(current_date - 7)$$,
  '42501', null, 'anon is refused'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000e0002');
select throws_ok(
  $$select public.content_funnel_export(current_date - 7)$$,
  '42501', null, 'a signed-in owner is refused'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
select throws_ok(
  $$select public.content_funnel_export(current_date - 7)$$,
  '42501', null, 'and so is the founder: this door is the content loop''s, the screen is theirs'
);

select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('anon', 'public.content_funnel_export(date)', 'execute')
  and not has_function_privilege('authenticated', 'public.content_funnel_export(date)', 'execute')
  and has_function_privilege('service_role', 'public.content_funnel_export(date)', 'execute'),
  'the grant is for service_role alone'
);
select ok(
  not has_function_privilege('anon', 'private.funnel_by_tag(date, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.funnel_by_tag(date, text)', 'execute')
  and not has_function_privilege('service_role', 'private.funnel_by_tag(date, text)', 'execute'),
  'the shared definition underneath is callable by no client role at all'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.content_funnel_export(date)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.content_funnel_export(date)'::regprocedure)
      @> array['search_path=""'],
  'it is a definer function with an empty search path'
);

-- ---------------------------------------------------------------------------
-- What it says.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
create temporary table ex as select public.content_funnel_export(current_date - 7) as j;
grant select on ex to public;
select pg_temp.act_as_postgres();

select is(
  (select array(select jsonb_object_keys(j) order by 1) from ex),
  array['by_source_ref', 'since', 'stalled'],
  'the answer has three keys: since, by_source_ref and stalled'
);
select is(
  (select j ->> 'since' from ex),
  date_trunc('week', current_date - 7)::date::text,
  'from the Monday of the week p_since falls in'
);
select is(
  (select j ->> 'since' from (select public.content_funnel_export(current_date - 5000) as j) x),
  date_trunc('week', current_date - 400)::date::text,
  'clamped to 400 days'
);
select throws_ok(
  $$select public.content_funnel_export(null)$$,
  '22023', 'invalid_period', 'a null period is refused'
);
select is(
  (select array(select jsonb_object_keys(j -> 'by_source_ref') order by 1) from ex),
  array['ig-never-lead-anywhere', 'rd-profile'],
  'the tags the content loop minted are listed, and a visitor''s own tag is not'
);
select is(
  (select j -> 'by_source_ref' -> 'ig-never-lead-anywhere' -> 'counters' ->> 'circles_created' from ex),
  '1', 'a tagged circle is counted under its tag'
);
select is(
  (select j -> 'by_source_ref' -> 'rd-profile' -> 'events' ->> 'plan_shared' from ex),
  '1', 'with the share of its plan'
);
select is(
  (select jsonb_agg(to_jsonb(r) - 'week') from jsonb_to_recordset((select j -> 'stalled' from ex))
     as r (week text, cohort text, source text, state text, circles int, oldest_hours int, median_hours int)),
  '[{"state":"not_shared","cohort":"external","source":"content","circles":1,"oldest_hours":30,"median_hours":30}]'::jsonb,
  'the stalled plans are the content source''s alone: reddit''s stalled plan is not in it'
);

-- ---------------------------------------------------------------------------
-- Nothing finer than counts.
-- ---------------------------------------------------------------------------
select ok(
  not (select j::text ~* '0000000e000|kmnpq|Maya|Pia|Quin|Sam|Circle |example\.com|@' from ex),
  'no seeded id, plan code, name or address appears anywhere in it'
);
select ok(
  not (select j::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' from ex),
  'and nothing shaped like a uuid does, whatever it is'
);
select is(
  (select array(select distinct k from ex, jsonb_array_elements(j -> 'stalled') e, jsonb_object_keys(e) k order by 1)),
  array['circles', 'cohort', 'median_hours', 'oldest_hours', 'source', 'state', 'week'],
  'a stalled row has exactly the seven fields: counts, ages and the words they are grouped by'
);
select is(
  (select array(select distinct k from ex, jsonb_each(j -> 'by_source_ref') t, jsonb_object_keys(t.value) k order by 1)),
  array['counters', 'events'],
  'a tag has counters and events and nothing else'
);

-- ---------------------------------------------------------------------------
-- One definition with the founder's.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0001');
create temporary table fa as select public.founder_analytics(current_date - 7) as j;
grant select on fa to public;
select pg_temp.act_as_postgres();
select is(
  (select j -> 'by_source_ref' from fa) - 'jane-doe-0412555123', (select j -> 'by_source_ref' from ex),
  'the founder''s funnel by tag is the export''s, key for key, and the founder alone also sees the visitor''s tag'
);
select is(
  (select coalesce(jsonb_agg(e order by e ->> 'state'), '[]') from fa, jsonb_array_elements(j -> 'stalled') e where e ->> 'source' = 'content'),
  (select coalesce(jsonb_agg(e order by e ->> 'state'), '[]') from ex, jsonb_array_elements(j -> 'stalled') e),
  'and the founder''s content rows of the stalled plans are the export''s'
);
select is(
  (select jsonb_array_length(j -> 'stalled') from fa), 2,
  'while the founder still sees every source''s stalled plans'
);

select * from finish();
rollback;
