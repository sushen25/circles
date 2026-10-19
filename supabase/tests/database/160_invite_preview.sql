-- The Join page's preview (S1-24): what a link holder sees before joining.
--
-- Who opens an invite link has no session, and a preview that needed one would
-- push a sign-in in front of the one page §5.1 says must come before any
-- prompt. Since SUS-214 (ADR 0081) the digest is an HMAC under a key the browser
-- cannot hold, so the page asks the `invite-preview` Edge Function, which has no
-- session either and calls this as the service role. So the function is
-- asserted as the service role, and as refused to every client role.
--
-- Sunday Crew, as ever: Maya owns it and made the link, Nina joined as a guest.

begin;
select plan(14);

-- SUS-114: `redeem_invite` is the service role's, called by its Edge Function
-- with the person it verified. This is that call, made for whoever the test is
-- acting as: it reads who that is, becomes the service role for the one call,
-- and goes back, so the assertions below read as they always did.
create or replace function pg_temp.redeem(h bytea, n text) returns public.circles
language plpgsql as $$
declare
  me uuid := auth.uid();
  prev text := current_setting('role');
  claims text := current_setting('request.jwt.claims', true);
  r public.circles;
begin
  -- The service role's own JWT, as in production: no `sub`, so `auth.uid()` is null.
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.redeem_invite(me, h, n, h);
  perform set_config('role', prev, true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return r;
end;
$$;

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

create or replace function pg_temp.act_as_nobody()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.act_as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
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

select pg_temp.make_user('16000000-0000-0000-0000-000000000001', 'Maya');
select pg_temp.make_user('16000000-0000-0000-0000-000000000002', 'Nina', true);
select pg_temp.make_user('16000000-0000-0000-0000-000000000003', 'Tom', true);

select pg_temp.act_as('16000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id
from public.create_circle('Sunday Crew', 'sky', 'Australia/Melbourne', 'sus40-preview');
grant select on fixture to authenticated, anon;

select pg_temp.act_as_postgres();

insert into public.circle_invites (circle_id, secret_hash, created_by)
select circle_id, extensions.digest('sunday-crew-live-secret', 'sha256'),
  '16000000-0000-0000-0000-000000000001'
from fixture;

select pg_temp.act_as('16000000-0000-0000-0000-000000000002', true);
select pg_temp.redeem(extensions.digest('sunday-crew-live-secret', 'sha256'), 'Nina');

-- ---------------------------------------------------------------------------
-- The allow: a stranger with the link.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select is(
  (select count(*)::integer
   from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))),
  1,
  'the Edge Function, holding a live link, gets one preview row'
);

select is(
  (select circle_name
   from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))),
  'Sunday Crew',
  'the preview names the circle'
);

select is(
  (select inviter_name
   from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))),
  'Maya',
  'and whoever made the link, by their name in the circle'
);

select is(
  (select member_initials
   from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))),
  array['M', 'N'],
  'and one initial per active member, in the order they joined'
);

-- The shape is the privacy boundary: three columns, none of them a roster.
select is(
  (select array_agg(p.parameter_name::text order by p.ordinal_position)
   from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'invite_preview'
     and p.parameter_mode = 'OUT'),
  array['circle_name', 'inviter_name', 'member_initials'],
  'returns a name, a name and initials, and nothing a later select * could widen'
);

-- Whoever asks, the answer is the same: it keys on the link, not the asker.
select pg_temp.act_as('16000000-0000-0000-0000-000000000003', true);
select throws_ok(
  $$select * from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))$$,
  '42501', 'permission denied for function invite_preview',
  'a signed-in guest cannot call it: they would be handing it a digest'
);
select pg_temp.act_as_nobody();
select throws_ok(
  $$select * from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))$$,
  '42501', 'permission denied for function invite_preview',
  'nor can a visitor with no session: the digest is not theirs to compute'
);
select pg_temp.act_as_service();
select is(
  (select circle_name
   from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))),
  'Sunday Crew',
  'and the Edge Function, which has no session, gets the preview'
);

-- ---------------------------------------------------------------------------
-- The denies: no row, the same no row, whatever the reason.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();

select is(
  (select count(*)::integer
   from public.invite_preview(extensions.digest('a-secret-nobody-issued', 'sha256'), extensions.digest('a-secret-nobody-issued', 'sha256'))),
  0,
  'an unknown link previews nothing'
);

select is(
  (select count(*)::integer from public.invite_preview(null)),
  0,
  'a null digest previews nothing rather than matching a row'
);

-- The inviter leaves: the link still works, and stops naming them.
select pg_temp.act_as_postgres();
update public.circle_invites set created_by = '16000000-0000-0000-0000-000000000002'
where circle_id = (select circle_id from fixture);
update public.circle_members set status = 'removed'
where circle_id = (select circle_id from fixture)
  and user_id = '16000000-0000-0000-0000-000000000002';

select pg_temp.act_as_service();
select is(
  (select row(inviter_name, member_initials)::text
   from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))),
  row(null::text, array['M'])::text,
  'a removed inviter is not named, and a removed member is not counted'
);

-- Revoked.
select pg_temp.act_as_postgres();
update public.circle_invites set revoked_at = now()
where circle_id = (select circle_id from fixture);

select pg_temp.act_as_service();
select is(
  (select count(*)::integer
   from public.invite_preview(extensions.digest('sunday-crew-live-secret', 'sha256'), extensions.digest('sunday-crew-live-secret', 'sha256'))),
  0,
  'a revoked link previews nothing'
);

-- Archived, with a live link.
select pg_temp.act_as_postgres();
insert into public.circle_invites (circle_id, secret_hash, created_by)
select circle_id, extensions.digest('sunday-crew-second-secret', 'sha256'),
  '16000000-0000-0000-0000-000000000001'
from fixture;
update public.circles set status = 'archived' where id = (select circle_id from fixture);

select pg_temp.act_as_service();
select is(
  (select count(*)::integer
   from public.invite_preview(extensions.digest('sunday-crew-second-secret', 'sha256'), extensions.digest('sunday-crew-second-secret', 'sha256'))),
  0,
  'a live link to an archived circle previews nothing'
);

select pg_temp.act_as_postgres();
select ok(
  not has_function_privilege('public', 'public.invite_preview(bytea, bytea)', 'execute')
  and not has_function_privilege('anon', 'public.invite_preview(bytea, bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.invite_preview(bytea, bytea)', 'execute')
  and has_function_privilege('service_role', 'public.invite_preview(bytea, bytea)', 'execute'),
  'the service role alone holds execute'
);

select * from finish();
rollback;
