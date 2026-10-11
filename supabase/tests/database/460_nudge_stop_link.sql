-- SUS-190 / ADR 0067: every cadence nudge carries a stop link that needs no
-- sign-in.
--
-- Allow: the token minted for Nina's address turns the nudge off for Nina in
-- every circle she is active in, queued nudges to her are skipped, a second tap
-- is harmless, and the answer reveals nothing.
-- Deny: a tampered, expired, unknown or other-purpose token is refused with the
-- same `link_expired`; a token for one person never reaches another; a
-- preferences token cannot stop nudges and a nudge token cannot read or stop
-- plan email; a suppressed contact is given no token; nobody but the service
-- role can call either function.

begin;
select plan(18);

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

create or replace function pg_temp.hash_of(token text) returns bytea
language sql as $$ select extensions.digest(token, 'sha256') $$;

create or replace function pg_temp.muted(who uuid) returns boolean[]
language sql security definer as $$
  select coalesce(array_agg(m.muted_nudges order by m.circle_id), '{}')
  from public.circle_members m where m.user_id = who and m.status = 'active'
$$;

-- Maya owns two circles; Nina is in both, Tom in the first only.
select pg_temp.make_user('00000000-0000-0000-0000-00000000a001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a002', 'Nina');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a003', 'Tom');

select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-nudge-stop-1', 'monthly');
select public.create_circle('Book Club', 'sky', 'Australia/Melbourne', 'key-nudge-stop-2', 'monthly');

select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select c.id, u.id, u.name
from public.circles c,
  (values ('00000000-0000-0000-0000-00000000a002'::uuid, 'Nina'),
          ('00000000-0000-0000-0000-00000000a003'::uuid, 'Tom')) as u (id, name)
where c.creation_key in ('key-nudge-stop-1', 'key-nudge-stop-2')
  and not (u.name = 'Tom' and c.creation_key = 'key-nudge-stop-2');

select pg_temp.act_as_service();
create temporary table c as
select public.dispatch_organiser_contact('00000000-0000-0000-0000-00000000a002') as nina,
       public.dispatch_organiser_contact('00000000-0000-0000-0000-00000000a003') as tom;
grant select on c to anon, authenticated, service_role;

-- 1-4: only the service role may call either function.
select pg_temp.act_as_postgres();
select ok(
  has_function_privilege('service_role', 'public.issue_nudge_stop_token(uuid, bytea)', 'execute')
  and has_function_privilege('service_role', 'public.stop_nudges(bytea)', 'execute'),
  'the service role can mint and spend a stop token'
);
select ok(
  not has_function_privilege('authenticated', 'public.issue_nudge_stop_token(uuid, bytea)', 'execute')
  and not has_function_privilege('anon', 'public.issue_nudge_stop_token(uuid, bytea)', 'execute'),
  'neither anon nor a signed-in caller can mint a stop token'
);
select ok(
  not has_function_privilege('authenticated', 'public.stop_nudges(bytea)', 'execute')
  and not has_function_privilege('anon', 'public.stop_nudges(bytea)', 'execute'),
  'neither anon nor a signed-in caller can call stop_nudges'
);

select pg_temp.act_as_service();
select isnt(
  public.issue_nudge_stop_token((select nina from c), pg_temp.hash_of('t-nina-stop')),
  null,
  'a verified contact that belongs to a user is given a stop token'
);
select public.issue_nudge_stop_token((select tom from c), pg_temp.hash_of('t-tom-stop'));
select public.issue_preferences_token((select nina from c), pg_temp.hash_of('t-nina-prefs'));

select is(
  pg_temp.muted('00000000-0000-0000-0000-00000000a002'), array[false, false],
  'before the tap, Nina is nudgeable in both circles'
);

-- 6-8: the tap.
select is(
  public.stop_nudges(pg_temp.hash_of('t-nina-stop')), '{"stopped": true}'::jsonb,
  'the tap answers stopped and nothing else: no name, no circle, no address'
);
select is(
  pg_temp.muted('00000000-0000-0000-0000-00000000a002'), array[true, true],
  'it turns the nudge off for Nina in every circle she is active in'
);
select is(
  pg_temp.muted('00000000-0000-0000-0000-00000000a003'), array[false],
  'and for nobody else: Tom is still nudgeable'
);

-- 9: repeat.
select is(
  public.stop_nudges(pg_temp.hash_of('t-nina-stop')), '{"stopped": true}'::jsonb,
  'a second tap, or a gateway opening the page again, is harmless and answers the same'
);

-- 10-12: refusals, all the same error.
select throws_ok(
  $$ select public.stop_nudges(pg_temp.hash_of('t-nina-stoq')) $$, 'P0001', 'link_expired',
  'a tampered token is refused'
);
select throws_ok(
  $$ select public.stop_nudges(pg_temp.hash_of('t-nina-prefs')) $$, 'P0001', 'link_expired',
  'a plan-email preferences token cannot stop nudges: another kind of mail'
);
select throws_ok(
  $$ select public.email_preferences(pg_temp.hash_of('t-nina-stop'), 'view') $$, 'P0001', 'link_expired',
  'and a stop-nudge token cannot read or stop plan email, or remove the address'
);

-- 13: another person's token never reaches Nina.
select pg_temp.act_as_postgres();
update public.circle_members set muted_nudges = false
where user_id = '00000000-0000-0000-0000-00000000a002';
select pg_temp.act_as_service();
select public.stop_nudges(pg_temp.hash_of('t-tom-stop'));
select is(
  pg_temp.muted('00000000-0000-0000-0000-00000000a002'), array[false, false],
  'Tom''s token stops Tom and leaves Nina nudgeable'
);

-- 14: an expired token.
select pg_temp.act_as_postgres();
update private.email_action_tokens set expires_at = now() - interval '1 minute'
where token_hash = pg_temp.hash_of('t-tom-stop');
select pg_temp.act_as_service();
select throws_ok(
  $$ select public.stop_nudges(pg_temp.hash_of('t-tom-stop')) $$, 'P0001', 'link_expired',
  'an expired token is refused'
);

-- 15-16: a queued nudge to Nina is skipped by the tap.
select pg_temp.act_as_postgres();
insert into jobs.notification_jobs (
  channel, kind, contact_id, circle_id, scheduled_for, idempotency_key
)
select 'email', 'about_time', c.nina, (select id from public.circles where creation_key = 'key-nudge-stop-1'),
  now() + interval '1 hour', repeat('a', 64)
from c;
select pg_temp.act_as_service();
select public.stop_nudges(pg_temp.hash_of('t-nina-stop'));
select is(
  (select status || ':' || last_error from jobs.notification_jobs where idempotency_key = repeat('a', 64)),
  'skipped:nudge_stopped',
  'a nudge already queued for Nina is skipped'
);

-- 17: a suppressed contact is given no token.
select pg_temp.act_as_postgres();
update private.email_contacts
set status = 'suppressed', suppressed_at = now(), suppression_reason = 'bounced', verified_at = null
where id = (select tom from c);
select pg_temp.act_as_service();
select is(
  public.issue_nudge_stop_token((select tom from c), pg_temp.hash_of('t-tom-stop-2')), null,
  'a suppressed contact is given no stop token, so the nudge is not sent'
);

-- 18-19: the token is stored as a digest, with the purpose and no membership.
select pg_temp.act_as_postgres();
select is(
  (select purpose from private.email_action_tokens where token_hash = pg_temp.hash_of('t-nina-stop')),
  'nudge_stop', 'the token is stored with its own purpose'
);
select is(
  (select used_at is null and membership_circle_id is null
   from private.email_action_tokens where token_hash = pg_temp.hash_of('t-nina-stop')),
  true, 'spending it did not consume it, and it carries no membership'
);

select * from finish();
rollback;
