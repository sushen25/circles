-- Continue-as resolves a code only while the code is live, and its limits are
-- enforced in SQL (SUS-103, ADR 0049).
--
-- Asserted as client roles with a JWT: the functions read `auth.uid()`, and run
-- as postgres they would all say yes. Dates are relative to `now()` so the
-- fourteen-day edge is the edge on any day the suite runs.

begin;
select plan(76);

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

create or replace function pg_temp.digest_of(secret text)
returns bytea
language sql
as $$ select extensions.digest(secret, 'sha256') $$;

-- Maya owns Live Crew; Nina is a guest with a verified address; Tom is a guest.
select pg_temp.make_user('29000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('29000000-0000-0000-0000-0000000000a1', 'Nina', true);
select pg_temp.make_user('29000000-0000-0000-0000-0000000000a2', 'Tom', true);
select pg_temp.make_user('29000000-0000-0000-0000-0000000000b1', 'Stranger', true);

select pg_temp.act_as('29000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id, short_code
from public.create_circle('Live Crew', 'sky', 'Australia/Melbourne', 'sus103-live');
grant select on fixture to authenticated;

select pg_temp.act_as_postgres();

create or replace function pg_temp.circle_id() returns uuid
language sql security definer as $$ select circle_id from fixture $$;
create or replace function pg_temp.circle_code() returns text
language sql security definer as $$ select short_code from fixture $$;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
values (pg_temp.circle_id(), '29000000-0000-0000-0000-0000000000a1', 'Nina'),
       (pg_temp.circle_id(), '29000000-0000-0000-0000-0000000000a2', 'Tom');

insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('29000000-0000-0000-0000-0000000000a1', 'nina-live@example.com', 'verified', now() - interval '2 days'),
       ('29000000-0000-0000-0000-0000000000a2', 'tom-live@example.com', 'verified', now() - interval '2 days');

insert into public.plans (
  circle_id, mode, state, organiser_user_id, title, time_zone,
  window_start, window_end, daily_start_local, daily_end_local,
  duration_minutes, quorum, response_deadline, short_code
)
values (pg_temp.circle_id(), 'named', 'collecting',
        '29000000-0000-0000-0000-000000000001', 'Catch up', 'Australia/Melbourne',
        date '2099-09-17', date '2099-09-20', 1050, 1350, 120, 2,
        timestamptz '2099-09-20T10:00:00Z', 'kvpqmanx');

create or replace function pg_temp.plan_id() returns uuid
language sql security definer as $$ select id from public.plans where short_code = 'kvpqmanx' $$;

-- A candidate and a confirmation the plan can be locked in on. Its times are
-- moved by `meetup_ended`, so each case says how long ago the meetup was.
insert into public.candidate_sets (
  plan_id, revision, input_version, scoring_version, input_hash,
  starts_considered, eligible_count, responded_count, active_member_count
)
values (pg_temp.plan_id(), 1, 1, 1, repeat('a', 64), 10, 1, 1, 3);

insert into public.candidates (
  candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
  explicit_count, flexible_count, explanation_code, explanation_count
)
select cs.id, false, 1, timestamptz '2099-09-17T08:30:00Z', timestamptz '2099-09-17T10:30:00Z',
       array['29000000-0000-0000-0000-0000000000a1'::uuid], 0, 1, 'best_attendance', 1
from public.candidate_sets cs where cs.plan_id = pg_temp.plan_id();

insert into public.meetup_confirmations (plan_id, revision, candidate_id, starts_at, ends_at,
  available_user_ids, confirmed_by)
select pg_temp.plan_id(), 1, c.id, c.starts_at, c.ends_at,
       array['29000000-0000-0000-0000-0000000000a1'::uuid],
       '29000000-0000-0000-0000-000000000001'
from public.candidates c
join public.candidate_sets cs on cs.id = c.candidate_set_id
where cs.plan_id = pg_temp.plan_id()
limit 1;

-- The plan's state, written the way `transition_plan` writes it. A test may not
-- reach into `state` otherwise, and this is the one place that says it is
-- pretending.
create or replace function pg_temp.set_state(p_state text) returns void
language plpgsql security definer as $$
begin
  perform set_config('circles.in_transition', 'on', true);
  update public.plans set state = p_state where short_code = 'kvpqmanx';
  perform set_config('circles.in_transition', 'off', true);
end;
$$;

-- When the meetup ended, as a number of days before now.
create or replace function pg_temp.meetup_ended(p_days_ago numeric, p_status text default 'active')
returns void
language sql security definer as $$
  update public.meetup_confirmations
  set starts_at = now() - make_interval(secs => p_days_ago * 86400 + 7200),
      ends_at = now() - make_interval(secs => p_days_ago * 86400),
      status = p_status,
      superseded_at = case when p_status = 'active' then null else now() end,
      superseded_reason = case when p_status = 'active' then null else 'outcome' end
  where plan_id = pg_temp.plan_id();
$$;

-- What a caller with no membership is offered, read as that caller.
create or replace function pg_temp.offered(p_code text) returns integer
language sql as $$
  select count(*)::integer from public.guest_members_for_reattach(p_code);
$$;

-- The roster limit is per caller per hour; each section starts afresh.
create or replace function pg_temp.fresh_limits() returns void
language sql security definer as $$ delete from jobs.rate_counters $$;

-- ---------------------------------------------------------------------------
-- A plan that is asking, or has options on offer, and the circle's own code
-- ---------------------------------------------------------------------------
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);

select is(pg_temp.offered('kvpqmanx'), 2, 'a collecting plan''s code lists the circle''s guests');
select is(pg_temp.offered(pg_temp.circle_code()), 2, 'the circle''s own code lists them too, while it is active');
select is((select circle_name from public.preview_for_code('p', 'kvpqmanx')), 'Live Crew', 'and the link preview names the circle');

select pg_temp.act_as_postgres();
select pg_temp.set_state('ready');
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 2, 'a plan with options on offer still lists them');

-- ---------------------------------------------------------------------------
-- What the link preview says about the plan (SUS-151, ADR 0054): a name and one
-- of two words, to a caller with no session at all
-- ---------------------------------------------------------------------------
create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- The state word for a code as anon would see it; null where there is no row.
create or replace function pg_temp.preview_state(p_kind text, p_code text) returns text
language sql as $$ select plan_state::text from public.preview_for_code(p_kind, p_code) $$;
create or replace function pg_temp.preview_rows(p_kind text, p_code text) returns integer
language sql as $$ select count(*)::integer from public.preview_for_code(p_kind, p_code) $$;

select pg_temp.act_as_postgres();
select pg_temp.set_state('collecting');
select pg_temp.as_anon();
select is(pg_temp.preview_state('p', 'kvpqmanx'), 'asking', 'a collecting plan is asking, as an unauthenticated caller sees it');
select is(pg_temp.preview_state('j', 'kvpqmanx'), 'asking', 'the /j/ link is the same plan, the same answer');

select pg_temp.act_as_postgres();
select pg_temp.set_state('ready');
select pg_temp.as_anon();
select is(pg_temp.preview_state('p', 'kvpqmanx'), 'asking', 'a plan with options on offer is still asking');

select pg_temp.act_as_postgres();
select pg_temp.set_state('confirmed');
select pg_temp.meetup_ended(-3);
select pg_temp.as_anon();
select is(pg_temp.preview_state('p', 'kvpqmanx'), 'locked_in', 'a confirmed plan with an active confirmation is locked in');
select is(pg_temp.preview_state('j', 'kvpqmanx'), 'locked_in', 'whichever of the two links is asked');
select is((select circle_name from public.preview_for_code('p', 'kvpqmanx')), 'Live Crew', 'and still names the circle');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(5, 'completed');
select pg_temp.set_state('completed');
select pg_temp.as_anon();
select is(pg_temp.preview_state('p', 'kvpqmanx'), 'locked_in', 'a completed plan inside the window is locked in');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(15, 'completed');
select pg_temp.as_anon();
select is(pg_temp.preview_rows('p', 'kvpqmanx'), 0, 'and past the window there is no row, exactly as before');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(2, 'cancelled');
select pg_temp.as_anon();
select is(pg_temp.preview_rows('p', 'kvpqmanx'), 0, 'a completed plan with a cancelled outcome has no row');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(-3);
select pg_temp.set_state('cancelled');
select pg_temp.as_anon();
select is(pg_temp.preview_rows('p', 'kvpqmanx'), 0, 'a cancelled plan has no row, so its link draws the generic card');

select pg_temp.act_as_postgres();
select pg_temp.set_state('expired');
select pg_temp.as_anon();
select is(pg_temp.preview_rows('p', 'kvpqmanx'), 0, 'an expired plan has no row');

select is(pg_temp.preview_rows('join', null), 0, '/join has no row');
select is(pg_temp.preview_rows('p', 'nxsuchcade'), 0, 'an unknown code has no row');
select is(pg_temp.preview_rows('p', 'not a code!'), 0, 'a malformed code has no row');
select is(pg_temp.preview_rows('p', null), 0, 'a null code has no row');

select pg_temp.act_as_postgres();
select pg_temp.set_state('collecting');
select pg_temp.set_state('ready');
select is(
  (select array(select jsonb_object_keys(to_jsonb(r)) order by 1)
   from public.preview_for_code('p', 'kvpqmanx') r),
  array['circle_name', 'plan_state'],
  'the answer has a name and a state and no other column'
);
select is(enum_range(null::public.preview_plan_state)::text, '{asking,locked_in}', 'and the state is a closed enum of two words');
select ok(has_function_privilege('anon', 'public.preview_for_code(text, text)', 'execute'), 'and the lookup is still granted to anon');

-- ---------------------------------------------------------------------------
-- A plan that is over
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select pg_temp.set_state('cancelled');
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'a cancelled plan''s code lists nobody');
select is((select count(*)::int from public.preview_for_code('p', 'kvpqmanx')), 0, 'and the preview is the generic one, as for a code that never existed');
select is(pg_temp.offered(pg_temp.circle_code()), 2, 'while the circle''s own code is unaffected by a plan ending');

select pg_temp.act_as_postgres();
select pg_temp.set_state('collecting');
select pg_temp.set_state('expired');
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'an expired plan''s code lists nobody');

select is(pg_temp.offered('nxsuchcade'), 0, 'and a code nobody issued lists nobody, the same answer');

-- ---------------------------------------------------------------------------
-- A plan that is locked in: inside the window, and past it (ADR 0049)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select pg_temp.fresh_limits();
select pg_temp.set_state('collecting');
select pg_temp.set_state('ready');
select pg_temp.set_state('confirmed');
select pg_temp.meetup_ended(-3);
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 2, 'a locked-in plan whose meetup is still ahead lists the guests (the "Locked in" link in the chat)');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(1);
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 2, 'the morning after, when the letter goes out, it still does');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(13.9);
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 2, 'and just inside fourteen days after it ended');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(14.1);
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'and not just after');
select is((select count(*)::int from public.preview_for_code('p', 'kvpqmanx')), 0, 'where the preview is generic too');

-- The same plan once the organiser has answered "did it happen?": the people
-- who come back to say "I was there" are inside the same window.
select pg_temp.act_as_postgres();
select pg_temp.fresh_limits();
select pg_temp.meetup_ended(5, 'completed');
select pg_temp.set_state('completed');
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 2, 'a completed plan inside the window still lists them, so "I was there" works');

select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(15, 'completed');
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'and not after it');

-- A cancelled outcome leaves a plan that is not a way back at all.
select pg_temp.act_as_postgres();
select pg_temp.meetup_ended(2, 'cancelled');
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'a plan whose meetup was reported cancelled has no live confirmation, so no list');

-- ---------------------------------------------------------------------------
-- An archived circle
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select pg_temp.fresh_limits();
select pg_temp.set_state('collecting');
-- (a completed plan cannot go back, so the archived case uses an asking plan: set it
-- by transaction-local flag, as `set_state` does.)
update public.circles set status = 'archived' where id = pg_temp.circle_id();
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered(pg_temp.circle_code()), 0, 'an archived circle''s own code lists nobody');
select is(pg_temp.offered('kvpqmanx'), 0, 'nor does the code of an asking plan in an archived circle');
select is((select count(*)::int from public.preview_for_code('p', 'kvpqmanx')), 0, 'and the preview is generic');

-- reattach_member refuses there, by list and by emailed link, and the link is
-- not spent by the refusal.
select pg_temp.act_as_postgres();
select public.issue_reentry_token(
  pg_temp.circle_id(),
  (select id from private.email_contacts where email_normalized = 'nina-live@example.com'),
  pg_temp.digest_of('archived-link'));

select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), '29000000-0000-0000-0000-0000000000a2') $$,
  'member_not_found',
  'reattach_member refuses on an archived circle'
);
select throws_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('archived-link')) $$,
  'member_not_found',
  'with an emailed link as well, and the same answer'
);

select pg_temp.act_as_postgres();
select is(
  (select used_at is null from private.email_action_tokens where token_hash = pg_temp.digest_of('archived-link')),
  true,
  'and the refusal rolled back, so the link is not spent'
);
select is(
  (select m.user_id from public.circle_members m
   where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = 'Tom'),
  '29000000-0000-0000-0000-0000000000a2'::uuid,
  'and nothing moved'
);

update public.circles set status = 'active' where id = pg_temp.circle_id();
update private.email_action_tokens set used_at = now()
where token_hash = pg_temp.digest_of('archived-link');

-- ---------------------------------------------------------------------------
-- The cap cannot be used against the member (ADR 0049)
--
-- Nina (a1) has a verified address. A stranger takes her place, she comes back
-- with her emailed link, the stranger takes it again, she comes back again —
-- and again. The list's moves are counted and the fourth is refused; her own
-- are not counted and not refused, whatever the count stands at.
-- ---------------------------------------------------------------------------
select pg_temp.make_user(('29000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'Taker ' || n, true)
from generate_series(1, 10) n;
select pg_temp.make_user(('29000000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid, 'Nina device ' || n, true)
from generate_series(1, 9) n;

create or replace function pg_temp.nina() returns uuid
language sql security definer as $$
  select m.user_id from public.circle_members m
  where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = 'Nina';
$$;

create or replace function pg_temp.emailed_link(p_name text) returns void
language sql security definer as $$
  select public.issue_reentry_token(
    pg_temp.circle_id(),
    (select c.id from private.email_contacts c where c.user_id = pg_temp.nina() and c.status = 'verified'),
    pg_temp.digest_of(p_name));
$$;

select pg_temp.emailed_link('link-1');
select pg_temp.act_as('29000000-0000-0000-0000-000000000101', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.nina()) $$,
  'a stranger takes Nina''s place (list move 1)'
);

select pg_temp.act_as('29000000-0000-0000-0000-000000000201', true);
select lives_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('link-1')) $$,
  'Nina takes it back with the link she was emailed'
);
select pg_temp.act_as_postgres();
select is(pg_temp.nina(), '29000000-0000-0000-0000-000000000201'::uuid, 'and it is hers again');

select pg_temp.emailed_link('link-2');
select pg_temp.act_as('29000000-0000-0000-0000-000000000102', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.nina()) $$,
  'the stranger takes it again (list move 2)'
);
select pg_temp.act_as('29000000-0000-0000-0000-000000000202', true);
select lives_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('link-2')) $$,
  'and Nina returns'
);

select pg_temp.act_as_postgres();
select pg_temp.emailed_link('link-3');
select pg_temp.act_as('29000000-0000-0000-0000-000000000103', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.nina()) $$,
  'a third time (list move 3)'
);

select pg_temp.act_as('29000000-0000-0000-0000-000000000104', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.nina()) $$,
  'reattach_limit',
  'and the fourth pick from the list is refused: the cap still stops people passing a name around'
);

select pg_temp.act_as('29000000-0000-0000-0000-000000000203', true);
select lives_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('link-3')) $$,
  'but Nina, five moves into the chain, gets back with her link: her moves are not counted and not refused'
);
select pg_temp.act_as_postgres();
select is(pg_temp.nina(), '29000000-0000-0000-0000-000000000203'::uuid, 'and the place is hers');

select is(
  (select count(*)::integer from private.audit_log a
   where a.action = 'circles.member_reattached' and a.resource_id = pg_temp.circle_id()
     and a.metadata ->> 'source' = 'email'),
  3,
  'the audit rows say which moves were hers'
);
select is(
  (select count(*)::integer from private.audit_log a
   where a.action = 'circles.member_reattached' and a.resource_id = pg_temp.circle_id()
     and a.metadata ->> 'source' = 'list'),
  3,
  'and which were picked from the list'
);

-- ---------------------------------------------------------------------------
-- What the cap does not do (ADR 0049, decision 4, as the founder decided it)
--
-- Contacts travel with a membership, so whoever took a place can verify a mailbox
-- of their own and be sent links for it. A move made with any valid link is
-- neither counted nor refused by the cap; the taker's own links are no different.
-- That is the stated residual (each move tells the owner, links come one per
-- letter), and this test is the record of it rather than a promise.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
create or replace function pg_temp.tom() returns uuid
language sql security definer as $$
  select m.user_id from public.circle_members m
  where m.circle_id = pg_temp.circle_id() and m.display_name_snapshot = 'Tom';
$$;
create or replace function pg_temp.link_for(p_email text, p_secret text) returns void
language sql security definer as $$
  select public.issue_reentry_token(
    pg_temp.circle_id(),
    (select c.id from private.email_contacts c where c.email_normalized = p_email),
    pg_temp.digest_of(p_secret));
$$;

select pg_temp.link_for('tom-live@example.com', 'tom-own-1');
select pg_temp.act_as('29000000-0000-0000-0000-000000000106', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.tom()) $$,
  'a stranger takes Tom''s place by list (list move 1)'
);

select pg_temp.act_as_postgres();
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values ('29000000-0000-0000-0000-000000000106', 'taker-own@example.com', 'verified', now());
select pg_temp.link_for('taker-own@example.com', 'taker-link-1');
select pg_temp.act_as('29000000-0000-0000-0000-000000000107', true);
select lives_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('taker-link-1')) $$,
  'a second stranger uses a link for the first one''s own mailbox: allowed, and not counted'
);

select pg_temp.act_as('29000000-0000-0000-0000-000000000206', true);
select lives_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('tom-own-1')) $$,
  'Tom returns with the link for his own address'
);

-- Two more list picks fill the cap (the first stranger's, and these), and a link
-- still gets Tom back, which is the property the cap exists to keep.
select pg_temp.link_for('tom-live@example.com', 'tom-own-2');
select pg_temp.act_as('29000000-0000-0000-0000-000000000108', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.tom()) $$,
  'a third stranger picks him from the list (list move 2)'
);
select pg_temp.act_as('29000000-0000-0000-0000-000000000109', true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.tom()) $$,
  'and a fourth (list move 3)'
);
select pg_temp.act_as('29000000-0000-0000-0000-000000000110', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.tom()) $$,
  'reattach_limit',
  'and a fifth pick from the list is refused'
);
select pg_temp.act_as('29000000-0000-0000-0000-000000000207', true);
select lives_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('tom-own-2')) $$,
  'while Tom''s own link still gets him back'
);
select pg_temp.act_as_postgres();
select is(pg_temp.tom(), '29000000-0000-0000-0000-000000000207'::uuid, 'and the place is his');

-- ---------------------------------------------------------------------------
-- The other states a plan's code is not live in, and a confirmation on a plan
-- revision that has moved on
-- ---------------------------------------------------------------------------
select pg_temp.fresh_limits();
select pg_temp.set_state('collecting');
select pg_temp.set_state('ready');
select pg_temp.set_state('confirmed');
select pg_temp.meetup_ended(1);
update public.plans set revision = revision + 1 where short_code = 'kvpqmanx';
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'a locked-in plan whose only confirmation belongs to an earlier revision lists nobody');

select pg_temp.act_as_postgres();
update public.plans set revision = revision - 1 where short_code = 'kvpqmanx';
select pg_temp.set_state('collecting');
select pg_temp.set_state('draft');
select pg_temp.fresh_limits();
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'a draft plan''s code lists nobody: it has never been shared');
select pg_temp.act_as_postgres();
select pg_temp.set_state('seeking');
select pg_temp.fresh_limits();
select pg_temp.act_as('29000000-0000-0000-0000-0000000000b1', true);
select is(pg_temp.offered('kvpqmanx'), 0, 'nor does a quiet ask still gathering interest');
select pg_temp.act_as_postgres();
select pg_temp.set_state('expired');
select pg_temp.act_as_postgres();
select private.circles_open_to_continue_as('kvpqmanx') as circle_id into temporary table seen;
select is((select count(*)::integer from seen), 0, 'the rule itself, asked as the database, says nobody');

-- An old audit row, from before the move recorded its source, counts as the
-- list's: the stricter reading.
select pg_temp.act_as_postgres();
update private.audit_log a set metadata = a.metadata - 'source'
where a.action = 'circles.member_reattached' and a.metadata ->> 'source' = 'list';
select pg_temp.act_as('29000000-0000-0000-0000-000000000105', true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.circle_id(), pg_temp.nina()) $$,
  'reattach_limit',
  'rows with no recorded source still count as the list''s'
);

-- A link does not outlive its seven days, whatever the cap says.
select pg_temp.act_as_postgres();
select pg_temp.emailed_link('stale-link');
update private.email_action_tokens set expires_at = now() - interval '1 minute'
where token_hash = pg_temp.digest_of('stale-link');
select pg_temp.act_as('29000000-0000-0000-0000-000000000204', true);
select throws_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('stale-link')) $$,
  'token_invalid',
  'an expired link is still refused: not counting its move is not the same as honouring it'
);

-- ---------------------------------------------------------------------------
-- The SQL-side limit, on a direct call (ADR 0049)
--
-- Ten guests, each moved twice: twenty completed moves in one circle in the
-- hour. The twenty-first — somebody's third, which the cap would allow — is
-- refused by the limit, and a person with an emailed link is not.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select pg_temp.fresh_limits();

select pg_temp.act_as('29000000-0000-0000-0000-000000000001');
create temporary table burst_fixture as
select id as circle_id from public.create_circle('Burst Crew', 'sky', 'Australia/Melbourne', 'sus103-burst');
grant select on burst_fixture to authenticated;
select pg_temp.act_as_postgres();

create or replace function pg_temp.burst_circle() returns uuid
language sql security definer as $$ select circle_id from burst_fixture $$;

select pg_temp.make_user(('29000000-0000-0000-00' || t.tag || '-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Burst ' || t.tag || n, true)
from (values ('10'), ('11'), ('12'), ('13')) as t(tag), generate_series(1, 10) n;

insert into public.circle_members (circle_id, user_id, display_name_snapshot)
select pg_temp.burst_circle(), ('29000000-0000-0000-0010-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Guest ' || n
from generate_series(1, 10) n;

create or replace function pg_temp.bid(tag text, n integer) returns uuid
language sql as $$
  select ('29000000-0000-0000-00' || tag || '-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

-- Moves guest tag `from_tag` number n onto tag `to_tag` number n, as the new identity.
create or replace function pg_temp.move_all(from_tag text, to_tag text) returns integer
language plpgsql as $$
declare done integer := 0;
begin
  for n in 1..10 loop
    perform pg_temp.act_as(('29000000-0000-0000-00' || to_tag || '-0000000000' || lpad(n::text, 2, '0'))::uuid, true);
    perform public.reattach_member(
      pg_temp.burst_circle(),
      ('29000000-0000-0000-00' || from_tag || '-0000000000' || lpad(n::text, 2, '0'))::uuid);
    done := done + 1;
  end loop;
  perform pg_temp.act_as_postgres();
  return done;
end;
$$;

select is(pg_temp.move_all('10', '11'), 10, 'ten direct calls from ten different sessions go through');
select is(pg_temp.move_all('11', '12'), 10, 'and ten more: twenty completed moves in the circle this hour');

select pg_temp.act_as(pg_temp.bid('13', 1), true);
select throws_ok(
  $$ select public.reattach_member(pg_temp.burst_circle(), pg_temp.bid('12', 1)) $$,
  'too_many_requests',
  'the twenty-first direct call is refused by the database, with no Edge Function in front of it'
);

select pg_temp.act_as_postgres();
select is(
  (select m.user_id from public.circle_members m
   where m.circle_id = pg_temp.burst_circle() and m.display_name_snapshot = 'Guest 1'),
  pg_temp.bid('12', 1),
  'and nothing moved'
);

-- The way back is not behind that limit: Guest 1's emailed link still works.
insert into private.email_contacts (user_id, email_normalized, status, verified_at)
values (pg_temp.bid('12', 1), 'guest1-burst@example.com', 'verified', now() - interval '2 days');
select public.issue_reentry_token(
  pg_temp.burst_circle(),
  (select id from private.email_contacts where email_normalized = 'guest1-burst@example.com'),
  pg_temp.digest_of('burst-link'));

select pg_temp.act_as(pg_temp.bid('13', 1), true);
select lives_ok(
  $$ select public.reattach_member(null, null, pg_temp.digest_of('burst-link')) $$,
  'a member with an emailed link comes back even when the circle''s hourly allowance is spent'
);

-- A fresh hour, and the limit lifts.
select pg_temp.act_as_postgres();
select pg_temp.fresh_limits();
select pg_temp.act_as(pg_temp.bid('13', 2), true);
select lives_ok(
  $$ select public.reattach_member(pg_temp.burst_circle(), pg_temp.bid('12', 2)) $$,
  'once the hour has passed the next call goes through'
);

-- ---------------------------------------------------------------------------
-- Grants: the new helpers are not callable from outside
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('authenticated', 'private.circles_open_to_continue_as(text)', 'execute')
  and not has_function_privilege('anon', 'private.circles_open_to_continue_as(text)', 'execute'),
  'the liveness rule is not an endpoint'
);
select ok(
  not has_function_privilege('authenticated', 'private.continue_as_window()', 'execute'),
  'nor is the window'
);
select is(private.continue_as_window(), interval '14 days', 'the window is fourteen days');

select * from finish();
rollback;
