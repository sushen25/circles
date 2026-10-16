-- SUS-125: small hardening.
--
-- Allow/deny for `circles` read by column (no `creation_key`), the one thing
-- that can be pinned about `pg_net` (nothing of ours calls it but the
-- scheduler), the service role's invite reissue, and the short-code sampler.

begin;
select plan(20);

create or replace function pg_temp.act_as(id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', id::text, 'role', 'authenticated', 'is_anonymous', false)::text, true);
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

insert into auth.users (
  id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '48000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'maya-480@example.com', false,
  '{"is_anonymous": false}',
  '{"display_name": "Maya", "time_zone": "Australia/Melbourne"}', now(), now()
);

select pg_temp.act_as('48000000-0000-0000-0000-000000000001');
create temporary table fixture as
select id as circle_id
from public.create_circle(
  'Sunday Crew', 'sky', 'Australia/Melbourne', 'sus125-key', 'monthly',
  extensions.digest('old-secret', 'sha256'), '48000000-0000-0000-0000-0000000000a1'
);
grant select on fixture to authenticated;

-- ---------------------------------------------------------------------------
-- circles: a member reads the columns they need, and not the idempotency key.
-- ---------------------------------------------------------------------------

select is(
  (select name from public.circles where id = (select circle_id from fixture)),
  'Sunday Crew',
  'a member still reads their circle'
);
select throws_ok(
  $$select creation_key from public.circles$$,
  '42501', null,
  'but not its creation_key'
);
select throws_ok(
  $$select * from public.circles$$,
  '42501', null,
  'and `select *` is refused rather than quietly narrowed'
);
select ok(
  not has_column_privilege('authenticated', 'public.circles', 'creation_key', 'select'),
  'authenticated holds no select on creation_key'
);
select ok(
  (select count(*) = 0
     from pg_attribute a
    where a.attrelid = 'public.circles'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname <> 'creation_key'
      and not has_column_privilege('authenticated', 'public.circles', a.attname, 'select')),
  'every other column is still readable, so no screen lost a field'
);
select throws_ok(
  $$insert into public.circles (owner_user_id, name, color, time_zone, short_code, creation_key)
    values ('48000000-0000-0000-0000-000000000001', 'Mine', 'sky', 'Australia/Melbourne', 'abcdefgh', 'k')$$,
  '42501', null,
  'and a client still cannot insert a circle directly'
);

select pg_temp.act_as_postgres();
select ok(
  exists (
    select 1 from pg_policy p
    where p.polrelid = 'public.circles'::regclass
      and p.polname = 'circles_no_anonymous_insert'
      and obj_description(p.oid, 'pg_policy') like 'Defence in depth%'),
  'the dead insert policy is kept, and says why'
);

-- ---------------------------------------------------------------------------
-- pg_net: ours is the scheduler's alone. (The client roles' grants on `net`
-- belong to supabase_admin and cannot be revoked from a migration, so the
-- guard is that nothing of ours is a way through.)
-- ---------------------------------------------------------------------------

select is(
  (select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private', 'jobs', 'planning', 'analytics')
      and p.prosrc ~* '\mnet\s*\.\s*http'),
  array['jobs.invoke_process_scheduled_jobs'],
  'only the scheduler calls pg_net; a definer function that wrapped it would reach every client'
);

-- ---------------------------------------------------------------------------
-- reissue_invite: the service role swaps the live invite; nobody else can.
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.reissue_invite(uuid, bytea, uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.reissue_invite(uuid, bytea, uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.reissue_invite(uuid, bytea, uuid, uuid)', 'execute'),
  'only the service role may reissue an invite'
);

select is(
  public.reissue_invite(
    (select circle_id from fixture), extensions.digest('new-secret', 'sha256'),
    '48000000-0000-0000-0000-0000000000a2', '48000000-0000-0000-0000-0000000000a1'
  ),
  true,
  'the invite the sweep saw is replaced'
);

select is(
  (select count(*)::integer from public.circle_invites
    where circle_id = (select circle_id from fixture) and revoked_at is null),
  1,
  'one live invite after the swap'
);
select is(
  (select id from public.circle_invites
    where circle_id = (select circle_id from fixture) and revoked_at is null),
  '48000000-0000-0000-0000-0000000000a2'::uuid,
  'and it is the new one'
);
select is(
  (select secret_hash from public.circle_invites
    where id = '48000000-0000-0000-0000-0000000000a2'),
  extensions.digest('new-secret', 'sha256'),
  'carrying the digest it was given'
);
select isnt(
  (select revoked_at from public.circle_invites where id = '48000000-0000-0000-0000-0000000000a1'),
  null,
  'the old link is revoked'
);
select is(
  (select created_by from public.circle_invites where id = '48000000-0000-0000-0000-0000000000a2'),
  '48000000-0000-0000-0000-000000000001'::uuid,
  'attributed to the circle''s owner'
);
select is(
  (select count(*)::integer from private.audit_log
    where action = 'circles.invite_reissued' and actor_user_id is null
      and resource_id = (select circle_id from fixture)),
  1,
  'with an audit row that has no actor, which is how an operator''s swap is told from an owner''s'
);
select throws_ok(
  $$select public.reissue_invite('48000000-0000-0000-0000-0000000000ff', extensions.digest('x', 'sha256'),
    '48000000-0000-0000-0000-0000000000a3', '48000000-0000-0000-0000-0000000000a1')$$,
  'P0002', 'circle_not_found',
  'an unknown circle is refused'
);

-- The owner reset the link after the sweep read it: the sweep's call is stale,
-- and must not revoke the link that is live now.
select is(
  public.reissue_invite(
    (select circle_id from fixture), extensions.digest('stale', 'sha256'),
    '48000000-0000-0000-0000-0000000000a4', '48000000-0000-0000-0000-0000000000a1'
  ),
  false,
  'a stale replacement does nothing'
);
select is(
  (select id from public.circle_invites
    where circle_id = (select circle_id from fixture) and revoked_at is null),
  '48000000-0000-0000-0000-0000000000a2'::uuid,
  'and the link that is live stays live'
);

-- ---------------------------------------------------------------------------
-- Short codes: drawn by rejection sampling, so every letter is as likely as
-- every other. The byte range is 0..255 and 31 does not divide 256.
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(p.prosrc ~ 'exit when pick <')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_plan', 'create_quiet_ask')),
  'create_plan and create_quiet_ask redraw a byte from the partial last run instead of taking it modulo 31'
);

select * from finish();
rollback;
