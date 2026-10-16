-- The limits that hold when the SQL is called directly.
--
-- The Edge Functions limit how often a person may do things, and every function
-- tested here is also granted to `authenticated`, so anybody signed in can call
-- it over /rest/v1/rpc/ and never meet them. The token is taken inside the
-- function, keyed on the caller, so the limit holds either way.
--
-- Three things are proved:
--   * the limit refuses after its size, for each function, by a real loop where
--     the calls are cheap and by filling the bucket where they are not;
--   * a bucket belongs to the person who spends it. Naming somebody else's plan
--     spends your own allowance and never theirs;
--   * the length and shape limits on what is stored, and the silent cap of one
--     verification letter per address per hour.
--
-- A limit counts the calls that complete. A call that raises later in its body
-- rolls its own count back with everything else it did, as `reattach_member`'s
-- does; what the limit bounds is the work a call does, and a refused call does
-- none.

begin;
select plan(34);

create or replace function pg_temp.make_user(id uuid, name text, permanent boolean default true)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', now(), not permanent,
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

-- Fills a bucket to its limit as the postgres role, the way the function's own
-- calls would have, for the one caller (and plan) the key names.
create or replace function pg_temp.fill(scope text, key text, size integer)
returns void language plpgsql as $$
declare
  was text := current_user;
begin
  perform set_config('role', 'postgres', true);
  perform public.take_rate_token(scope, extensions.digest(key, 'sha256'), size, interval '1 hour', size);
  perform set_config('role', was, true);
end;
$$;

-- Calls `stmt` up to `n` times and says on which call the limit refused it
-- (0 if it never did). Any other error is the call failing for its own
-- reasons and is passed over.
create or replace function pg_temp.refused_at(stmt text, n integer)
returns integer language plpgsql as $$
declare
  i integer;
  msg text;
begin
  for i in 1..n loop
    begin
      execute stmt;
    exception when others then
      get stacked diagnostics msg = message_text;
      if msg = 'too_many_requests' then
        return i;
      end if;
    end;
  end loop;
  return 0;
end;
$$;

-- Maya organises; Eve is a stranger who knows Maya's plan id; Ada is another
-- saved place for the loops; Gus is an anonymous guest.
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a2', 'Eve');
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a3', 'Ada');
select pg_temp.make_user('00000000-0000-0000-0000-0000000009a4', 'Gus', false);

insert into public.circles (id, owner_user_id, name, color, time_zone, short_code, creation_key)
values ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a1',
  'Sunday Crew', 'sky', 'Australia/Melbourne', 'cmqrts', 'key-limits-sql');
insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
values ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a1', 'Maya', 'owner');

create or replace function pg_temp.new_plan(code text)
returns uuid language sql as $$
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  ) values (
    '00000000-0000-0000-0000-0000000009c1', 'named', 'collecting',
    '00000000-0000-0000-0000-0000000009a1', 'Catch up', 'Australia/Melbourne',
    date '2099-03-01', date '2099-03-04', 1050, 1350, 120, 2,
    timestamptz '2099-02-28T00:00:00Z', code
  ) returning id;
$$;

create temporary table plans_under_test as
  select pg_temp.new_plan('pnqrtaa') as a, pg_temp.new_plan('pnqrtbb') as b,
         pg_temp.new_plan('pnqrtcc') as c, pg_temp.new_plan('pnqrtdd') as d;
grant select on plans_under_test to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A real loop, refused after its size
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');

select is(
  pg_temp.refused_at($$select public.issue_invite('00000000-0000-0000-0000-0000000009c1', extensions.digest(gen_random_uuid()::text, 'sha256'))$$, 125),
  121,
  'issue_invite: the owner can rotate the link a hundred and twenty times an hour, and the next is refused'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a3');
select is(
  pg_temp.refused_at($$select public.create_circle('Loop', 'sky', 'Australia/Melbourne', gen_random_uuid()::text)$$, 65),
  61,
  'create_circle: sixty circles an hour, and the sixty-first is refused'
);

select throws_ok(
  $$select public.create_circle('One more', 'sky', 'Australia/Melbourne', 'key-one-more')$$,
  'P0003', 'too_many_requests',
  'and it stays refused with a fresh key, so the idempotency key is not a way round it'
);

-- ---------------------------------------------------------------------------
-- A bucket at its size refuses the next call, for each function
-- ---------------------------------------------------------------------------
select pg_temp.fill('replace_response_sql', '00000000-0000-0000-0000-0000000009a1', 600);
select pg_temp.fill('revise_plan_sql', '00000000-0000-0000-0000-0000000009a1', 60);
select pg_temp.fill('confirm_meetup_sql', '00000000-0000-0000-0000-0000000009a1', 60);
select pg_temp.fill('cancel_plan_sql', '00000000-0000-0000-0000-0000000009a3', 60);
select pg_temp.fill('create_plan_sql', '00000000-0000-0000-0000-0000000009a1', 200);
select pg_temp.fill('redeem_invite_sql', '00000000-0000-0000-0000-0000000009a4', 120);

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');

select throws_ok(
  format($$select public.replace_response(%L, 1, 'none')$$, (select a from plans_under_test)),
  'P0003', 'too_many_requests',
  'replace_response: refused once the caller has used six hundred an hour'
);
select throws_ok(
  format($$select public.revise_plan(%L)$$, (select a from plans_under_test)),
  'P0003', 'too_many_requests',
  'revise_plan: refused once the caller has used sixty an hour'
);
select throws_ok(
  format($$select public.confirm_meetup(%L, 'x', gen_random_uuid(), null)$$, (select a from plans_under_test)),
  'P0003', 'too_many_requests',
  'confirm_meetup: refused once the caller has used sixty an hour'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a3');
select throws_ok(
  format($$select public.cancel_plan(%L)$$, (select a from plans_under_test)),
  'P0003', 'too_many_requests',
  'cancel_plan: refused once the caller has used sixty an hour'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');
select throws_ok(
  format($$select public.create_plan(%L, 'x', null, date '2099-03-01', date '2099-03-02', 1050, 1350, 120, null, now() + interval '1 day')$$,
    '00000000-0000-0000-0000-0000000009c1'),
  'P0003', 'too_many_requests',
  'create_plan: refused once the caller has used two hundred an hour'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a4');
select throws_ok(
  $$select public.redeem_invite(extensions.digest('a link', 'sha256'), 'Gus')$$,
  'P0003', 'too_many_requests',
  'redeem_invite: refused once the caller has used a hundred and twenty an hour, an anonymous guest included'
);

-- ---------------------------------------------------------------------------
-- The plan bucket is the caller's own
-- ---------------------------------------------------------------------------
select pg_temp.fill('cancel_plan_sql_plan',
  '00000000-0000-0000-0000-0000000009a2:' || (select b from plans_under_test), 20);
select pg_temp.fill('revise_plan_sql_plan',
  '00000000-0000-0000-0000-0000000009a2:' || (select b from plans_under_test), 20);
select pg_temp.fill('replace_response_sql_plan',
  '00000000-0000-0000-0000-0000000009a2:' || (select b from plans_under_test), 300);

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a2');
select throws_ok(
  format($$select public.cancel_plan(%L)$$, (select b from plans_under_test)),
  'P0003', 'too_many_requests',
  'Eve, who has used her own allowance on Maya''s plan, is refused'
);

select pg_temp.fill('cancel_plan_sql_plan',
  '00000000-0000-0000-0000-0000000009a2:' || (select c from plans_under_test), 20);
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');
select lives_ok(
  format($$select public.cancel_plan(%L, 'Not this month')$$, (select b from plans_under_test)),
  'but that is hers to spend: Maya cancels the same plan, and nothing Eve did against it counts against her'
);
select is(
  (select state from public.plans where id = (select b from plans_under_test)),
  'cancelled',
  'and the plan is cancelled'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.rate_counters
   where scope = 'cancel_plan_sql_plan'
     and key_hash = extensions.digest('00000000-0000-0000-0000-0000000009a1:' || (select b from plans_under_test), 'sha256')),
  1,
  'the cancellation was counted against Maya''s own key, one row'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');

-- ---------------------------------------------------------------------------
-- cancel_note: 280 and no more
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$select public.cancel_plan(%L, %L)$$, (select c from plans_under_test), repeat('n', 280)),
  'a cancel note of 280 characters is stored'
);
select throws_ok(
  format($$select public.cancel_plan(%L, %L)$$, (select d from plans_under_test), repeat('n', 281)),
  '23514', null,
  'a cancel note of 281 characters is refused, whichever door it came through'
);
select is(
  (select state from public.plans where id = (select d from plans_under_test)),
  'collecting',
  'and the plan it was meant for is still collecting'
);

-- ---------------------------------------------------------------------------
-- What create_circle will store
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');
select throws_ok(
  $$select public.create_circle(E'Sunday\r\nBcc: someone', 'sky', 'Australia/Melbourne', 'key-newline')$$,
  '23514', null,
  'a circle name with a line break is refused: it would reach an email subject'
);
select throws_ok(
  $$select public.create_circle('Tab' || chr(9) || 'bed', 'sky', 'Australia/Melbourne', 'key-tab')$$,
  '23514', null,
  'and so is any other control character'
);
select throws_ok(
  $$select public.create_circle('Fine', repeat('c', 25), 'Australia/Melbourne', 'key-colour')$$,
  '23514', null,
  'a colour is a palette token, not an essay'
);
select throws_ok(
  $$select public.create_circle('Fine', 'sky', 'Australia/Melbourne', repeat('k', 65))$$,
  '23514', null,
  'an idempotency key longer than sixty-four characters is refused'
);
select lives_ok(
  $$select public.create_circle('Sunday Crew 2', 'sky', 'Australia/Melbourne', repeat('k', 64))$$,
  'and sixty-four is fine'
);

-- ---------------------------------------------------------------------------
-- One verification letter per address per hour, said to nobody
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a2', 'Eve'),
       ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a3', 'Ada')
on conflict (circle_id, user_id) do update
  set display_name_snapshot = excluded.display_name_snapshot, status = 'active';

create or replace function pg_temp.letters_for(addr text) returns integer
language sql security definer as $$
  select count(*)::integer from jobs.notification_jobs j
  join private.email_contacts c on c.id = j.contact_id
  where j.kind = 'verify_email' and c.email_normalized = addr
$$;

select pg_temp.act_as_service();
create temporary table first_answer as
  select public.request_email_updates((select a from plans_under_test),
    '00000000-0000-0000-0000-0000000009a2', 'friend@example.org', '2026-09-14', 'req-1') as answer;
grant select on first_answer to service_role;

select is(pg_temp.letters_for('friend@example.org'), 1, 'the first request for an address enqueues its letter');

select is(
  public.request_email_updates((select a from plans_under_test),
    '00000000-0000-0000-0000-0000000009a2', 'friend@example.org', '2026-09-14', 'req-2'),
  (select answer from first_answer),
  'a second request for it inside the hour is answered exactly as the first was'
);
select is(pg_temp.letters_for('friend@example.org'), 1, 'and sends no second letter');

select is(
  public.request_email_updates((select a from plans_under_test),
    '00000000-0000-0000-0000-0000000009a3', 'friend@example.org', '2026-09-14', 'req-3'),
  (select answer from first_answer),
  'a different member naming the same address gets the same answer too'
);
select is(pg_temp.letters_for('friend@example.org'), 1, 'and no letter, whoever asks');

select is(
  (select count(*)::integer from private.email_subscriptions s
   join private.email_contacts c on c.id = s.contact_id
   where c.email_normalized = 'friend@example.org' and s.status = 'active'),
  2,
  'the consent each of them gave is still recorded'
);

select is(
  (select (public.request_email_updates((select a from plans_under_test),
    '00000000-0000-0000-0000-0000000009a2', 'other@example.org', '2026-09-14', 'req-4')) = (select answer from first_answer)),
  true,
  'another address is a separate allowance, and its answer is the same shape'
);
select is(pg_temp.letters_for('other@example.org'), 1, 'and its own letter goes out');

-- ---------------------------------------------------------------------------
-- rename_in_circle (SUS-224): 120 an hour, and each member's own
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a2', 'Eve'),
       ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a3', 'Ada')
on conflict (circle_id, user_id) do update
  set display_name_snapshot = excluded.display_name_snapshot, status = 'active';

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a3');
select is(
  pg_temp.refused_at($$select public.rename_in_circle('00000000-0000-0000-0000-0000000009c1', 'Ada')$$, 125),
  121,
  'rename_in_circle: a hundred and twenty renames an hour called directly, and the next is refused'
);
select throws_ok(
  $$select public.rename_in_circle('00000000-0000-0000-0000-0000000009c1', 'Ada L')$$,
  'P0003', 'too_many_requests',
  'and it stays refused, whatever name is asked for'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a2');
select lives_ok(
  $$select public.rename_in_circle('00000000-0000-0000-0000-0000000009c1', 'Eve B')$$,
  'Eve, in the same circle, is not affected by Ada having used her allowance'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');
select lives_ok(
  $$select public.rename_in_circle('00000000-0000-0000-0000-0000000009c1', 'Maya M')$$,
  'nor is the owner'
);
select pg_temp.act_as_postgres();
select is(
  (select count(*)::integer from jobs.rate_counters
   where scope = 'rename_in_circle_sql'
     and key_hash in (extensions.digest('00000000-0000-0000-0000-0000000009a2', 'sha256'),
                      extensions.digest('00000000-0000-0000-0000-0000000009a1', 'sha256'))),
  2,
  'each was counted in a bucket named by the person, never by the circle'
);

select * from finish();
rollback;
