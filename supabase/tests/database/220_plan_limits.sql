-- A plan may ask about up to thirty days and last up to five hours (SUS-88,
-- ADR 0030 and ADR 0031).
--
-- The rules are the domain's, proved in `presets.test.ts`; what is proved here
-- is that the database says the same thing after migration 0023: the thirtieth
-- day is allowed and the thirty-first is not, 240 and 300 minutes are allowed
-- and a number outside the set is not, and a circle's default may be five
-- hours too.
--
-- Maya owns a circle and organises in it. Nobody else is involved.

begin;
select plan(7);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', now(), false,
    jsonb_build_object('is_anonymous', false),
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000008a1', 'Maya');

insert into public.circles (id, owner_user_id, name, color, time_zone, short_code, creation_key)
values ('00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000008a1',
  'Limits', 'sky', 'Australia/Melbourne', 'cmxpts', 'key-limits');

-- One plan, with the window and the length the test names. Evenings
-- (5:30–10:30 pm) is the band, so five hours fit it exactly and the deadline
-- is a day before any of them.
create or replace function pg_temp.plan_with(code text, last_day date, minutes integer)
returns void language sql as $$
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  ) values (
    '00000000-0000-0000-0000-0000000008c1', 'named', 'collecting',
    '00000000-0000-0000-0000-0000000008a1', 'Catch up', 'Australia/Melbourne',
    date '2099-03-01', last_day, 1050, 1350, minutes, 2,
    timestamptz '2099-02-28T00:00:00Z', code
  );
$$;

-- The window (ADR 0030)

select lives_ok(
  $$select pg_temp.plan_with('pnwnd3z', date '2099-03-30', 120)$$,
  'a window of thirty days is accepted'
);
select throws_ok(
  $$select pg_temp.plan_with('pnwnd3x', date '2099-03-31', 120)$$,
  '23514', null,
  'a window of thirty-one days is refused by plans_window_length'
);

-- The length (ADR 0031)

select lives_ok(
  $$select pg_temp.plan_with('pndurfv', date '2099-03-02', 300)$$,
  'five hours are accepted, and fit the evenings band exactly'
);
select lives_ok(
  $$select pg_temp.plan_with('pndurfr', date '2099-03-02', 240)$$,
  'four hours are accepted'
);
select throws_ok(
  $$select pg_temp.plan_with('pndurbd', date '2099-03-02', 210)$$,
  '23514', null,
  'a length outside the set is still refused by plans_duration'
);

-- The circle's default (ADR 0031)

select lives_ok(
  $$update public.circles set default_duration_minutes = 300
    where id = '00000000-0000-0000-0000-0000000008c1'$$,
  'a circle may default to five hours'
);
select throws_ok(
  $$update public.circles set default_duration_minutes = 210
    where id = '00000000-0000-0000-0000-0000000008c1'$$,
  '23514', null,
  'a circle default outside the set is still refused by circles_default_duration'
);

select * from finish();
rollback;
