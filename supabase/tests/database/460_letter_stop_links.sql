-- SUS-190 / ADR 0067 and SUS-110 / ADR 0069: every account-holder letter
-- carries a stop link that needs no sign-in.
--
-- Three families, one mechanism: `nudges` (the cadence nudge), `organiser`
-- (options ready, replies closed, did it happen) and `quiet` (the quiet ask's
-- two letters to its initiator), each with a token purpose of its own.
--
-- Allow: the token minted for Nina's address writes the flag the settings
-- screen writes for its family, for Nina and nobody else (every circle she is
-- active in for the two per-circle flags, her profile for the organiser flag),
-- queued letters of that family are skipped, a second tap is harmless, and the
-- answer reveals nothing.
-- Deny: a tampered, expired, unknown, other-purpose or other-family token is
-- refused with the same `link_expired`; a token for one person never reaches
-- another; a preferences token stops none of the three and none of these can
-- read or stop plan email; a family's token touches no other family's flag or
-- queued letter; a suppressed contact is given no token; nobody but the
-- service role can call either function.

begin;

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

-- Each flag a stop link can write, for one person: the two per-circle flags
-- (one value per active circle) and the profile's.
create or replace function pg_temp.muted(who uuid) returns boolean[]
language sql security definer as $$
  select coalesce(array_agg(m.muted_nudges order by m.circle_id), '{}')
  from public.circle_members m where m.user_id = who and m.status = 'active'
$$;
create or replace function pg_temp.quiet_muted(who uuid) returns boolean[]
language sql security definer as $$
  select coalesce(array_agg(m.muted_quiet_asks order by m.circle_id), '{}')
  from public.circle_members m where m.user_id = who and m.status = 'active'
$$;
create or replace function pg_temp.organiser_muted(who uuid) returns boolean
language sql security definer as $$
  select p.muted_organiser_email from public.profiles p where p.user_id = who
$$;
-- All three flags at once, one letter per circle: nudges, quiet asks, then the
-- profile's organiser email. `t` is stopped.
create or replace function pg_temp.flags(who uuid) returns text
language sql security definer as $$
  select 'n=' || coalesce((select string_agg(case when m.muted_nudges then 't' else 'f' end, '' order by m.circle_id)
                           from public.circle_members m where m.user_id = who and m.status = 'active'), '')
      || ' q=' || coalesce((select string_agg(case when m.muted_quiet_asks then 't' else 'f' end, '' order by m.circle_id)
                            from public.circle_members m where m.user_id = who and m.status = 'active'), '')
      || ' o=' || (select case when p.muted_organiser_email then 't' else 'f' end
                   from public.profiles p where p.user_id = who)
$$;
create or replace function pg_temp.job_status(key text) returns text
language sql security definer as $$
  select status || coalesce(':' || last_error, '') from jobs.notification_jobs
  where idempotency_key = repeat(key, 64)
$$;

-- Maya owns two circles; Nina is in both, Tom in the first only.
select pg_temp.make_user('00000000-0000-0000-0000-00000000a001', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a002', 'Nina');
select pg_temp.make_user('00000000-0000-0000-0000-00000000a003', 'Tom');

select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-letter-stop-1', 'monthly');
select public.create_circle('Book Club', 'sky', 'Australia/Melbourne', 'key-letter-stop-2', 'monthly');

select pg_temp.act_as_postgres();
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select c.id, u.id, u.name
from public.circles c,
  (values ('00000000-0000-0000-0000-00000000a002'::uuid, 'Nina'),
          ('00000000-0000-0000-0000-00000000a003'::uuid, 'Tom')) as u (id, name)
where c.creation_key in ('key-letter-stop-1', 'key-letter-stop-2')
  and not (u.name = 'Tom' and c.creation_key = 'key-letter-stop-2');

select pg_temp.act_as_service();
create temporary table c as
select public.dispatch_organiser_contact('00000000-0000-0000-0000-00000000a002') as nina,
       public.dispatch_organiser_contact('00000000-0000-0000-0000-00000000a003') as tom;
grant select on c to anon, authenticated, service_role;

select plan(45);

-- 1-3: only the service role may call either function.
select pg_temp.act_as_postgres();
select ok(
  has_function_privilege('service_role', 'public.issue_stop_token(uuid, text, bytea)', 'execute')
  and has_function_privilege('service_role', 'public.stop_letters(bytea, text)', 'execute'),
  'the service role can mint and spend a stop token'
);
select ok(
  not has_function_privilege('authenticated', 'public.issue_stop_token(uuid, text, bytea)', 'execute')
  and not has_function_privilege('anon', 'public.issue_stop_token(uuid, text, bytea)', 'execute'),
  'neither anon nor a signed-in caller can mint a stop token'
);
select ok(
  not has_function_privilege('authenticated', 'public.stop_letters(bytea, text)', 'execute')
  and not has_function_privilege('anon', 'public.stop_letters(bytea, text)', 'execute'),
  'neither anon nor a signed-in caller can call stop_letters'
);

-- 4-6: minting. A token per family, for a verified contact that belongs to a user.
select pg_temp.act_as_service();
select isnt(
  public.issue_stop_token((select nina from c), 'nudge_stop', pg_temp.hash_of('t-nina-nudge')),
  null,
  'a verified contact that belongs to a user is given a nudge stop token'
);
select public.issue_stop_token((select nina from c), 'organiser_stop', pg_temp.hash_of('t-nina-org'));
select public.issue_stop_token((select nina from c), 'quiet_stop', pg_temp.hash_of('t-nina-quiet'));
select public.issue_stop_token((select tom from c), 'nudge_stop', pg_temp.hash_of('t-tom-nudge'));
select public.issue_stop_token((select tom from c), 'organiser_stop', pg_temp.hash_of('t-tom-org'));
select public.issue_stop_token((select tom from c), 'quiet_stop', pg_temp.hash_of('t-tom-quiet'));
select public.issue_preferences_token((select nina from c), pg_temp.hash_of('t-nina-prefs'));
select throws_ok(
  $$ select public.issue_stop_token((select nina from c), 'prefs', pg_temp.hash_of('t-x')) $$,
  'P0001', 'invalid_stop_purpose',
  'it will not mint a preferences, verification or re-entry token: only the three stop purposes'
);
select throws_ok(
  $$ select public.issue_stop_token((select nina from c), null, pg_temp.hash_of('t-y')) $$,
  'P0001', 'invalid_stop_purpose',
  'nor a token with no purpose'
);

select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a002'), 'n=ff q=ff o=f',
  'before any tap, Nina has every letter on, in both circles'
);

-- ---------------------------------------------------------------- nudges
-- 8-11: the cadence nudge (SUS-190).
select is(
  public.stop_letters(pg_temp.hash_of('t-nina-nudge'), 'nudges'), '{"stopped": true}'::jsonb,
  'the tap answers stopped and nothing else: no name, no circle, no address'
);
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a002'), 'n=tt q=ff o=f',
  'it turns the nudge off for Nina in every circle she is active in, and writes nothing else'
);
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a003'), 'n=f q=f o=f',
  'and for nobody else: Tom is still nudgeable'
);
select is(
  public.stop_letters(pg_temp.hash_of('t-nina-nudge'), 'nudges'), '{"stopped": true}'::jsonb,
  'a second tap, or a gateway opening the page again, is harmless and answers the same'
);

-- ------------------------------------------------------------- organiser
-- 13-18: the organiser's letters.
select is(
  public.stop_letters(pg_temp.hash_of('t-nina-org'), 'organiser'), '{"stopped": true}'::jsonb,
  'the organiser tap answers stopped and nothing else'
);
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a002'), 'n=tt q=ff o=t',
  'it turns "Emails about plans you organise" off for Nina, and leaves quiet asks alone'
);
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a003') || ' / ' || pg_temp.flags('00000000-0000-0000-0000-00000000a001'),
  'n=f q=f o=f / n=ff q=ff o=f',
  'and for nobody else: Tom and Maya still have it on'
);
select is(
  public.stop_letters(pg_temp.hash_of('t-nina-org'), 'organiser'), '{"stopped": true}'::jsonb,
  'a second organiser tap is harmless'
);
select is(
  (select count(*)::int from private.email_subscriptions s
   join private.email_contacts k on k.id = s.contact_id where k.user_id = '00000000-0000-0000-0000-00000000a002'
     and s.status <> 'active'),
  0,
  'plan-update subscriptions are not touched: they have their own stop link'
);

-- --------------------------------------------------------------- quiet
-- 19-23: the quiet ask's letters.
select is(
  public.stop_letters(pg_temp.hash_of('t-nina-quiet'), 'quiet'), '{"stopped": true}'::jsonb,
  'the quiet tap answers stopped and nothing else'
);
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a002'), 'n=tt q=tt o=t',
  'it turns quiet asks off for Nina in every circle she is active in'
);
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a003'), 'n=f q=f o=f',
  'and for nobody else: Tom still has quiet asks on'
);
select is(
  public.stop_letters(pg_temp.hash_of('t-nina-quiet'), 'quiet'), '{"stopped": true}'::jsonb,
  'a second quiet tap is harmless'
);
select is(
  (select count(*)::int from jobs.notification_jobs where contact_id in (select nina from c)), 0,
  'and no letter was queued for Nina by any tap'
);

-- ------------------------------------------------------------- refusals
-- 24-34: all the same error.
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-nudgx'), 'nudges') $$, 'P0001', 'link_expired',
  'a tampered token is refused'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-prefs'), 'nudges') $$, 'P0001', 'link_expired',
  'a plan-email preferences token cannot stop nudges: another kind of mail'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-prefs'), 'organiser') $$, 'P0001', 'link_expired',
  'nor the organiser''s letters'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-prefs'), 'quiet') $$, 'P0001', 'link_expired',
  'nor the quiet ask''s'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-org'), 'nudges') $$, 'P0001', 'link_expired',
  'an organiser token cannot stop nudges: another family'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-org'), 'quiet') $$, 'P0001', 'link_expired',
  'nor quiet asks'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-quiet'), 'organiser') $$, 'P0001', 'link_expired',
  'a quiet token cannot stop the organiser''s letters'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-nudge'), 'organiser') $$, 'P0001', 'link_expired',
  'a nudge token cannot stop the organiser''s letters'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-org'), 'plan_updates') $$, 'P0001', 'link_expired',
  'a family that does not exist is refused, so no family string reaches anything else'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-nina-org'), null) $$, 'P0001', 'link_expired',
  'and so is none'
);
select throws_ok(
  $$ select public.email_preferences(pg_temp.hash_of('t-nina-org'), 'view') $$, 'P0001', 'link_expired',
  'and a stop token cannot read or stop plan email, or remove the address'
);

-- 35-37: another person's token never reaches Nina, in any family.
select pg_temp.act_as_postgres();
update public.circle_members set muted_nudges = false, muted_quiet_asks = false
where user_id = '00000000-0000-0000-0000-00000000a002';
update public.profiles set muted_organiser_email = false
where user_id = '00000000-0000-0000-0000-00000000a002';
select pg_temp.act_as_service();
select public.stop_letters(pg_temp.hash_of('t-tom-nudge'), 'nudges');
select public.stop_letters(pg_temp.hash_of('t-tom-org'), 'organiser');
select public.stop_letters(pg_temp.hash_of('t-tom-quiet'), 'quiet');
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a002'), 'n=ff q=ff o=f',
  'Tom''s tokens leave Nina with every letter on'
);
select is(
  pg_temp.flags('00000000-0000-0000-0000-00000000a003'), 'n=t q=t o=t',
  'and stop Tom in all three families'
);

-- 38-40: an expired token, in each family.
select pg_temp.act_as_postgres();
update private.email_action_tokens set expires_at = now() - interval '1 minute'
where token_hash in (pg_temp.hash_of('t-tom-nudge'), pg_temp.hash_of('t-tom-org'), pg_temp.hash_of('t-tom-quiet'));
select pg_temp.act_as_service();
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-tom-nudge'), 'nudges') $$, 'P0001', 'link_expired',
  'an expired nudge token is refused'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-tom-org'), 'organiser') $$, 'P0001', 'link_expired',
  'an expired organiser token is refused'
);
select throws_ok(
  $$ select public.stop_letters(pg_temp.hash_of('t-tom-quiet'), 'quiet') $$, 'P0001', 'link_expired',
  'an expired quiet token is refused'
);

-- 41-44: letters already queued for Nina are skipped by their own family's tap, and only that one's.
select pg_temp.act_as_postgres();
update public.circle_members set muted_nudges = false, muted_quiet_asks = false
where user_id = '00000000-0000-0000-0000-00000000a002';
update public.profiles set muted_organiser_email = false
where user_id = '00000000-0000-0000-0000-00000000a002';
insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
select id, 'named', 'collecting', '00000000-0000-0000-0000-00000000a001',
  'Catch up', 'Australia/Melbourne', date '2099-09-17', date '2099-09-20',
  1050, 1350, 120, 2, timestamptz '2099-09-20T10:00:00Z', 'dsphvz'
from public.circles where creation_key = 'key-letter-stop-1';
-- The nudge is about a circle; the rest are about a plan.
insert into jobs.notification_jobs (
  channel, kind, contact_id, circle_id, plan_id, plan_revision, scheduled_for, idempotency_key
)
select 'email', k.kind, c.nina,
  case when k.kind = 'about_time'
       then (select id from public.circles where creation_key = 'key-letter-stop-1') end,
  case when k.kind = 'about_time' then null
       else (select id from public.plans where short_code = 'dsphvz') end,
  case when k.kind = 'about_time' then null else 1 end,
  now() + interval '1 hour', repeat(k.key, 64)
from c, (values ('about_time', 'a'), ('options_ready', 'b'), ('replies_closed', 'c'),
                ('did_it_happen', 'd'), ('threshold_initiator', 'e'), ('quiet_expired', 'f')) as k (kind, key);
select pg_temp.act_as_service();
select public.stop_letters(pg_temp.hash_of('t-nina-org'), 'organiser');
select is(
  array[pg_temp.job_status('b'), pg_temp.job_status('c'), pg_temp.job_status('d')],
  array['skipped:organiser_email_off', 'skipped:organiser_email_off', 'skipped:organiser_email_off'],
  'the organiser tap skips the queued options ready, replies closed and did it happen'
);
select is(
  array[pg_temp.job_status('a'), pg_temp.job_status('e'), pg_temp.job_status('f')],
  array['scheduled', 'scheduled', 'scheduled'],
  'and leaves the queued nudge and quiet ask letters alone'
);
select public.stop_letters(pg_temp.hash_of('t-nina-quiet'), 'quiet');
select is(
  array[pg_temp.job_status('e'), pg_temp.job_status('f')],
  array['skipped:quiet_asks_muted', 'skipped:quiet_asks_muted'],
  'the quiet tap skips the queued threshold and expired letters'
);
select public.stop_letters(pg_temp.hash_of('t-nina-nudge'), 'nudges');
select is(
  pg_temp.job_status('a'), 'skipped:nudge_stopped',
  'the nudge tap skips the queued nudge'
);

-- 45: a suppressed contact is given no token, in any family.
select pg_temp.act_as_postgres();
update private.email_contacts
set status = 'suppressed', suppressed_at = now(), suppression_reason = 'bounced', verified_at = null
where id = (select tom from c);
select pg_temp.act_as_service();
select is(
  array[public.issue_stop_token((select tom from c), 'nudge_stop', pg_temp.hash_of('t-s1')),
        public.issue_stop_token((select tom from c), 'organiser_stop', pg_temp.hash_of('t-s2')),
        public.issue_stop_token((select tom from c), 'quiet_stop', pg_temp.hash_of('t-s3'))]::uuid[],
  array[null, null, null]::uuid[],
  'a suppressed contact is given no stop token, so the letter is not sent'
);

-- 46-48: the token is stored as a digest, with its own purpose and no membership.
select pg_temp.act_as_postgres();
select is(
  (select array_agg(purpose order by purpose) from private.email_action_tokens
   where token_hash in (pg_temp.hash_of('t-nina-nudge'), pg_temp.hash_of('t-nina-org'), pg_temp.hash_of('t-nina-quiet'))),
  array['nudge_stop', 'organiser_stop', 'quiet_stop'],
  'each token is stored with its own purpose'
);
select is(
  (select bool_and(used_at is null and membership_circle_id is null)
   from private.email_action_tokens
   where token_hash in (pg_temp.hash_of('t-nina-nudge'), pg_temp.hash_of('t-nina-org'), pg_temp.hash_of('t-nina-quiet'))),
  true, 'spending them did not consume them, and they carry no membership'
);
select is(
  (select min(expires_at - created_at) >= interval '364 days' from private.email_action_tokens
   where token_hash in (pg_temp.hash_of('t-nina-nudge'), pg_temp.hash_of('t-nina-org'), pg_temp.hash_of('t-nina-quiet'))),
  true, 'each lasts a year'
);

select * from finish();
rollback;
