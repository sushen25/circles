-- Scheduled work, from the outside: the lease, the schedule, and every
-- retention rule with one row it must delete and one it must not.
--
-- Backdating goes around the `updated_at` triggers deliberately, as the
-- owner, because "thirty days ago" cannot be arranged any other way in a
-- test that runs today.

begin;
select plan(40);

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

create or replace function pg_temp.win(day text, from_min integer, to_min integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'start', ((day::date::timestamp + make_interval(mins => from_min)) at time zone 'Australia/Melbourne'),
    'end', ((day::date::timestamp + make_interval(mins => to_min)) at time zone 'Australia/Melbourne')
  );
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000006a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000006a2', 'Priya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000006a3', 'Tom');
select pg_temp.make_user('00000000-0000-0000-0000-0000000006a4', 'Sam');

select pg_temp.act_as('00000000-0000-0000-0000-0000000006a1');
select public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'key-retention');
select public.create_circle('Old Crew', 'sky', 'Australia/Melbourne', 'key-retention-old');
select pg_temp.act_as_postgres();
create temporary table t as select id as circle_id from public.circles where creation_key = 'key-retention';
create temporary table t_old as select id as circle_id from public.circles where creation_key = 'key-retention-old';
grant select on t, t_old to anon, authenticated, service_role;
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, u, n from t, (values
  ('00000000-0000-0000-0000-0000000006a2'::uuid, 'Priya'),
  ('00000000-0000-0000-0000-0000000006a3'::uuid, 'Tom'),
  ('00000000-0000-0000-0000-0000000006a4'::uuid, 'Sam')
) as v (u, n);
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000006a2', 'Priya' from t_old;

-- A plan whose band runs from 9 am, so a window can cover a morning.
create or replace function pg_temp.make_plan(circle uuid, code text, day date)
returns uuid language plpgsql as $$
declare
  new_id uuid;
begin
  insert into public.plans (
    circle_id, mode, state, organiser_user_id, title, time_zone,
    window_start, window_end, daily_start_local, daily_end_local,
    duration_minutes, quorum, response_deadline, short_code
  ) values (
    circle, 'named', 'collecting', '00000000-0000-0000-0000-0000000006a1',
    'Catch up', 'Australia/Melbourne', day, day + 6, 540, 1350, 120, 2,
    (day::timestamp + interval '1 day') at time zone 'Australia/Melbourne', code
  ) returning id into new_id;
  insert into public.plan_participants (plan_id, revision, user_id)
  select new_id, 1, m.user_id from public.circle_members m where m.circle_id = circle;
  return new_id;
end;
$$;

-- 2099-09-14 is a Monday; +3 Thursday, +5 Saturday.
select pg_temp.make_plan((select circle_id from t), 'pnretaa', date '2099-09-14') as plan_a \gset
select pg_temp.make_plan((select circle_id from t_old), 'pnretbb', date '2099-09-14') as plan_old \gset

-- Priya offers a weekday evening and a weekend morning-into-afternoon; Tom a
-- weekday evening; Sam the same in the circle that will be archived.
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a2');
select public.replace_response(:'plan_a', 1, 'windows', jsonb_build_array(
  pg_temp.win('2099-09-17', 1050, 1170), pg_temp.win('2099-09-19', 600, 780)));
select public.replace_response(:'plan_old', 1, 'windows', jsonb_build_array(pg_temp.win('2099-09-17', 1050, 1170)));
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a3');
select public.replace_response(:'plan_a', 1, 'windows', jsonb_build_array(pg_temp.win('2099-09-17', 1050, 1170)));
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a4');
select public.replace_response(:'plan_a', 1, 'windows', jsonb_build_array(pg_temp.win('2099-09-17', 1050, 1170)));
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- The schedule and the lease.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(jobname order by jobname) from cron.job where jobname in ('process-jobs', 'retention')),
  array['process-jobs', 'retention'],
  'both jobs are scheduled'
);
select is(
  (select command from cron.job where jobname = 'process-jobs'),
  'select jobs.invoke_process_scheduled_jobs()',
  'the minute job calls the function and spells out no header'
);
select is(jobs.invoke_process_scheduled_jobs(), null, 'with no settings the invoker makes no call and returns null');
select is(
  (select array_agg(name order by name) from jobs.cron_leases),
  array['process_scheduled_jobs', 'retention_daily'],
  'a lease row exists per job before the first run'
);

select pg_temp.act_as_service();
select ok(jobs.acquire_lease('process_scheduled_jobs', interval '5 minutes', 'run-1'), 'the first caller takes the lease');
select ok(not jobs.acquire_lease('process_scheduled_jobs', interval '5 minutes', 'run-2'), 'the second does not, while it is held');
select ok(not jobs.release_lease('process_scheduled_jobs', 'run-2'), 'and cannot release what it does not hold');
select ok(jobs.release_lease('process_scheduled_jobs', 'run-1'), 'the holder releases');
select ok(jobs.acquire_lease('process_scheduled_jobs', interval '5 minutes', 'run-2'), 'and the next caller takes it');
select pg_temp.act_as_postgres();
update jobs.cron_leases set leased_until = now() - interval '1 second' where name = 'process_scheduled_jobs';
select pg_temp.act_as_service();
select ok(jobs.acquire_lease('process_scheduled_jobs', interval '5 minutes', 'run-3'), 'a lapsed lease is taken over');
select ok(not jobs.release_lease('process_scheduled_jobs', 'run-2'), 'and the late finisher cannot release the new holder''s');
select throws_ok(
  $$select jobs.acquire_lease('process_scheduled_jobs', interval '0', 'run-4')$$,
  '23514', null, 'a lease with no length is refused'
);
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- Retention fixtures: one old, one recent, per rule.
-- ---------------------------------------------------------------------------

-- Outbox: an old processed row goes; an old unprocessed one never does.
select jobs.emit('circles.invite_rotated', 'circle', (select circle_id from t), '{}') as old_done \gset
select jobs.emit('circles.invite_rotated', 'circle', (select circle_id from t), '{}') as old_stuck \gset
update jobs.outbox set occurred_at = now() - interval '31 days', processed_at = now() - interval '31 days' where id = :'old_done';
update jobs.outbox set occurred_at = now() - interval '31 days' where id = :'old_stuck';

-- Notification jobs and delivery events.
insert into private.email_contacts (user_id, email_normalized) values
  ('00000000-0000-0000-0000-0000000006a2', 'priya@example.com')
returning id as contact \gset
insert into jobs.notification_jobs (id, channel, kind, contact_id, plan_id, plan_revision, scheduled_for, idempotency_key, created_at)
values
  ('00000000-0000-0000-0000-00000000f001', 'email', 'locked_in', :'contact', :'plan_a', 1, now(), repeat('a', 64), now() - interval '31 days'),
  ('00000000-0000-0000-0000-00000000f002', 'email', 'locked_in', :'contact', :'plan_a', 1, now(), repeat('b', 64), now() - interval '1 day');
insert into private.email_delivery_events (job_id, provider_message_id, event_type, recorded_at) values
  ('00000000-0000-0000-0000-00000000f002', 'old', 'delivered', now() - interval '31 days'),
  ('00000000-0000-0000-0000-00000000f002', 'new', 'delivered', now() - interval '1 day');

-- Invites: revoked long ago, revoked recently, live.
insert into public.circle_invites (circle_id, secret_hash, created_by, revoked_at) values
  ((select circle_id from t), extensions.digest('i1', 'sha256'), '00000000-0000-0000-0000-0000000006a1', now() - interval '31 days'),
  ((select circle_id from t), extensions.digest('i2', 'sha256'), '00000000-0000-0000-0000-0000000006a1', now() - interval '1 day'),
  ((select circle_id from t), extensions.digest('i3', 'sha256'), '00000000-0000-0000-0000-0000000006a1', null);

-- Tokens: expired 8 days ago, used 8 days ago, live.
insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at, used_at) values
  (:'contact', 'verify', extensions.digest('t1', 'sha256'), now() - interval '8 days', null),
  (:'contact', 'verify', extensions.digest('t2', 'sha256'), now() + interval '1 day', now() - interval '8 days'),
  (:'contact', 'verify', extensions.digest('t3', 'sha256'), now() + interval '1 day', null);

-- Contacts: pending old / pending recent; verified with a plan long finished /
-- verified with a live plan; suppressed old.
insert into private.email_contacts (user_id, email_normalized, created_at) values
  ('00000000-0000-0000-0000-0000000006a3', 'tom-old@example.com', now() - interval '8 days'),
  ('00000000-0000-0000-0000-0000000006a3', 'tom-new@example.com', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000006a3', 'tom-retry@example.com', now() - interval '8 days');
-- The old-but-retrying one asked for a fresh link yesterday.
insert into private.email_action_tokens (contact_id, purpose, token_hash, expires_at)
select id, 'verify', extensions.digest('t-retry', 'sha256'), now() + interval '1 day'
from private.email_contacts where email_normalized = 'tom-retry@example.com';
insert into private.email_contacts (user_id, email_normalized, status, verified_at, created_at) values
  ('00000000-0000-0000-0000-0000000006a4', 'sam-done@example.com', 'verified', now() - interval '60 days', now() - interval '60 days'),
  ('00000000-0000-0000-0000-0000000006a4', 'sam-live@example.com', 'verified', now() - interval '60 days', now() - interval '60 days'),
  ('00000000-0000-0000-0000-0000000006a4', 'sam-stopped@example.com', 'verified', now() - interval '60 days', now() - interval '60 days');
insert into private.email_contacts (user_id, email_normalized, status, suppressed_at, suppression_reason, created_at) values
  ('00000000-0000-0000-0000-0000000006a4', 'sam-bounced@example.com', 'suppressed', now() - interval '400 days', 'bounced', now() - interval '400 days');
select pg_temp.make_plan((select circle_id from t), 'pnretdd', date '2099-10-05') as plan_done \gset
select planning.transition_plan(:'plan_done', 'cancel', '00000000-0000-0000-0000-0000000006a1', '{"cancel_note": "x"}');
-- Fire the queued deferred constraint triggers first: a table with pending
-- trigger events cannot be altered.
set constraints all immediate;
alter table public.plans disable trigger plans_touch_updated_at;
update public.plans set updated_at = now() - interval '31 days' where id = :'plan_done';
alter table public.plans enable trigger plans_touch_updated_at;
insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version)
select c.id, c.user_id, 'plan_updates', case c.email_normalized when 'sam-done@example.com' then :'plan_done'::uuid else :'plan_a'::uuid end, 'v1'
from private.email_contacts c where c.email_normalized in ('sam-done@example.com', 'sam-live@example.com');
-- Subscribed to a live plan, then said stop: the address has no reason left.
insert into private.email_subscriptions (contact_id, user_id, scope, plan_id, consent_text_version, status, withdrawn_at)
select c.id, c.user_id, 'plan_updates', :'plan_a'::uuid, 'v1', 'withdrawn', now() - interval '31 days'
from private.email_contacts c where c.email_normalized = 'sam-stopped@example.com';

-- Anonymous identities: abandoned, member, and a permanent one with nothing.
select pg_temp.make_user('00000000-0000-0000-0000-0000000006b1', 'Ghost', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000006b2', 'Guest', true);
select pg_temp.make_user('00000000-0000-0000-0000-0000000006b3', 'Loner', false);
update auth.users set created_at = now() - interval '31 days' where id in (
  '00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006b2', '00000000-0000-0000-0000-0000000006b3');
insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select circle_id, '00000000-0000-0000-0000-0000000006b2', 'Guest' from t;

-- Audit log.
insert into private.audit_log (action, resource_type, occurred_at) values
  ('circle.renamed', 'circle', now() - interval '13 months'),
  ('circle.renamed', 'circle', now() - interval '1 day');

-- Windows: Priya's answer is 13 months old, Tom's is fresh; Sam's circle is
-- archived and has been for a month.
update public.plan_responses set submitted_at = now() - interval '13 months'
where plan_id = :'plan_a' and user_id = '00000000-0000-0000-0000-0000000006a2';
set constraints all immediate;
alter table public.circles disable trigger circles_touch_updated_at;
update public.circles set status = 'archived', updated_at = now() - interval '31 days' where id = (select circle_id from t_old);
alter table public.circles enable trigger circles_touch_updated_at;

select count(*)::integer as windows_before from public.willing_windows \gset

-- ---------------------------------------------------------------------------
-- The run.
-- ---------------------------------------------------------------------------

select jobs.run_retention() as ran \gset

select is((:'ran'::jsonb ->> 'outbox')::integer, 1, 'one processed outbox row went');
select ok(exists (select 1 from jobs.outbox where id = :'old_stuck'), 'the unprocessed one, however old, did not');
select is((select count(*)::integer from jobs.notification_jobs), 1, 'the old notification job went, the recent one stayed');
select is((select provider_message_id from private.email_delivery_events), 'new', 'the old delivery event went');
select is(
  (select count(*)::integer from public.circle_invites where circle_id = (select circle_id from t)),
  2, 'the invite revoked a month ago went; the recent revocation and the live link stayed'
);
select is(
  (select array_agg(encode(token_hash, 'hex') = encode(extensions.digest('t3', 'sha256'), 'hex')) from private.email_action_tokens where contact_id = :'contact'),
  array[true], 'expired and used tokens went after a week; the live one stayed'
);
select is(
  (select array_agg(email_normalized order by email_normalized) from private.email_contacts where user_id = '00000000-0000-0000-0000-0000000006a3'),
  array['tom-new@example.com', 'tom-retry@example.com'],
  'the address nobody verified in a week went; the one with a link still clickable did not'
);
select is(
  (select array_agg(email_normalized order by email_normalized) from private.email_contacts where user_id = '00000000-0000-0000-0000-0000000006a4'),
  array['sam-bounced@example.com', 'sam-live@example.com'],
  'the verified contact whose only plan finished a month ago went, and so did the one who withdrew; the live one stayed; the suppressed one is kept forever'
);
select is(
  (select array_agg(id::text order by id) from auth.users where id::text like '00000000-0000-0000-0000-0000000006b%'),
  array['00000000-0000-0000-0000-0000000006b2', '00000000-0000-0000-0000-0000000006b3'],
  'the abandoned guest went; the guest who joined a circle and the permanent identity stayed'
);
select is((select count(*)::integer from private.audit_log where action = 'circle.renamed'), 1, 'the year-old audit row went');
select is((select action from private.audit_log order by occurred_at desc limit 1), 'retention.ran', 'and the run wrote itself down');

-- Windows and the summary.
select is(
  (select count(*)::integer from public.willing_windows w join public.plan_responses r on r.id = w.response_id
   where r.user_id = '00000000-0000-0000-0000-0000000006a2' and r.plan_id = :'plan_a'),
  0, 'Priya''s year-old windows went'
);
select is(
  (select count(*)::integer from public.willing_windows w join public.plan_responses r on r.id = w.response_id
   where r.user_id = '00000000-0000-0000-0000-0000000006a3'),
  1, 'Tom''s fresh one stayed'
);
select is(
  (select summary from public.member_dayparts where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000006a2'),
  '{"parts": ["weekday_evening", "weekend_morning", "weekend_afternoon"],
    "counts": {"weekday_morning": 0, "weekday_afternoon": 0, "weekday_evening": 1,
               "weekend_morning": 1, "weekend_afternoon": 1, "weekend_evening": 0}}'::jsonb,
  'but what she usually offers was written first — a Saturday 10–1 counts as morning and afternoon, as dayPartsCovered has it'
);
select is(
  (select count(*)::integer from public.willing_windows w join public.plan_responses r on r.id = w.response_id
   where r.plan_id = :'plan_old'),
  0, 'the archived circle''s windows went after a month'
);
select is(
  (select count(*)::integer from public.member_dayparts where circle_id = (select circle_id from t_old)),
  0, 'and no summary was kept for it'
);
select is(
  :'windows_before' - (select count(*)::integer from public.willing_windows),
  3, 'and that is everything that went: three windows, no more'
);

-- A second answer of Priya's crosses the line on a later night. The summary
-- adds to what it holds; it does not start again from what is left.
select pg_temp.make_plan((select circle_id from t), 'pnretcc', date '2099-10-05') as plan_c \gset
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a2');
select public.replace_response(:'plan_c', 1, 'windows', jsonb_build_array(pg_temp.win('2099-10-10', 1080, 1200)));
select pg_temp.act_as_postgres();
update public.plan_responses set submitted_at = now() - interval '13 months'
where plan_id = :'plan_c' and user_id = '00000000-0000-0000-0000-0000000006a2';
select is((select jobs.run_retention() ->> 'windows_aged')::integer, 1, 'the next run ages the newly old window');
select is(
  (select summary from public.member_dayparts where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000006a2'),
  '{"parts": ["weekday_evening", "weekend_morning", "weekend_afternoon", "weekend_evening"],
    "counts": {"weekday_morning": 0, "weekday_afternoon": 0, "weekday_evening": 1,
               "weekend_morning": 1, "weekend_afternoon": 1, "weekend_evening": 1}}'::jsonb,
  'and the summary now carries both nights: the Saturday evening joined the earlier three, which were not recomputed away'
);

-- Idempotent: a further run finds nothing.
select is(
  (select jobs.run_retention() - 'daypart_summaries'),
  '{"outbox": 0, "audit_rows": 0, "windows_aged": 0, "delivery_events": 0, "revoked_invites": 0, "pending_contacts": 0, "notification_jobs": 0, "plan_only_contacts": 0, "expired_action_links": 0, "windows_of_the_gone": 0, "anonymous_identities": 0, "daypart_summaries_purged": 0}'::jsonb,
  'a second run deletes nothing'
);

-- ---------------------------------------------------------------------------
-- Who may read the summary.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000006a2');
select is((select count(*)::integer from public.member_dayparts), 1, 'Priya reads her own summary');
select throws_ok(
  format($$insert into public.member_dayparts (circle_id, user_id, summary) values ('%s', '00000000-0000-0000-0000-0000000006a2', '{"parts": [], "counts": {}}')$$, (select circle_id from t)),
  '42501', null, 'and cannot write one'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a1');
select is((select count(*)::integer from public.member_dayparts), 0, 'Maya, the owner, reads nobody''s — it pre-fills, it does not score');

-- Removed, Priya reads nothing; a month on, the summary itself goes.
select pg_temp.act_as_postgres();
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000006a2';
select pg_temp.act_as('00000000-0000-0000-0000-0000000006a2');
select is((select count(*)::integer from public.member_dayparts), 0, 'a removed member no longer reads their summary');
select pg_temp.act_as_postgres();
set constraints all immediate;
alter table public.circle_members disable trigger circle_members_touch_updated_at;
update public.circle_members set updated_at = now() - interval '31 days'
where circle_id = (select circle_id from t) and user_id = '00000000-0000-0000-0000-0000000006a2';
alter table public.circle_members enable trigger circle_members_touch_updated_at;
select is((select jobs.run_retention() ->> 'daypart_summaries_purged')::integer, 1, 'the run counts the summary it purged');
select is(
  (select count(*)::integer from public.member_dayparts where user_id = '00000000-0000-0000-0000-0000000006a2'),
  0, 'and thirty days after removal the summary is deleted with the windows'
);
select pg_temp.act_as_service();
select throws_ok('select jobs.run_retention()', '42501', null, 'the service role cannot run retention; cron does, as the owner');
select throws_ok('select jobs.invoke_process_scheduled_jobs()', '42501', null, 'nor invoke the dispatcher by hand');

select * from finish();
rollback;
