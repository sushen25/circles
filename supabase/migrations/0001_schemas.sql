-- Baseline: the four schemas, the extensions, and the membership helper every
-- RLS policy will be written against.
--
-- Architecture §8.1 divides the database by who may reach it:
--
--   public     everything a client may read, through RLS. Exposed via the Data API.
--   private    email contacts, tokens, quiet-ask interest, push tokens. Never exposed.
--   analytics  insert-only events and the founder's views. Never exposed.
--   jobs       outbox, notification jobs, cron bookkeeping. Never exposed.
--
-- "Never exposed" is enforced in three places, because one is not enough: the
-- Data API is configured for `public` only (config.toml), the roles hold no
-- privileges here, and `000_smoke.sql` fails the build if either slips.

create schema if not exists private;
create schema if not exists analytics;
create schema if not exists jobs;

comment on schema private is
  'Not exposed through the Data API. Reachable only by security-definer functions and the service role.';
comment on schema analytics is
  'Insert-only events and founder views. Not exposed through the Data API.';
comment on schema jobs is
  'Outbox, notification jobs, cron leases. Not exposed through the Data API.';

-- Extensions live in `extensions`, never `public`: a client-visible schema
-- should hold the product's tables and nothing else.
create extension if not exists pgcrypto with schema extensions;
-- Exclusion constraints on time ranges — no two confirmations for one plan.
create extension if not exists btree_gist with schema extensions;
-- Scheduled work is discovered from data, never from an in-memory timer (§9.3).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Default-deny. `anon` and `authenticated` get nothing in these schemas, so a
-- future table cannot become readable by being created without a policy.
revoke all on schema private from anon, authenticated;
revoke all on schema analytics from anon, authenticated;
revoke all on schema jobs from anon, authenticated;

revoke all on all tables in schema private from anon, authenticated;
revoke all on all tables in schema analytics from anon, authenticated;
revoke all on all tables in schema jobs from anon, authenticated;

-- And nothing created later inherits a grant either.
alter default privileges in schema private revoke all on tables from anon, authenticated;
alter default privileges in schema analytics revoke all on tables from anon, authenticated;
alter default privileges in schema jobs revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The membership helper.
--
-- Every `select` policy on a public table is `auth_is_member(circle_id)`
-- (§8.4). It is defined here, ahead of the table it reads, so the policies in
-- S1-07 are written against a signature that already exists and so the name
-- cannot drift.
--
-- It returns false until `public.circle_members` lands in S1-07. That is the
-- safe direction to be wrong in: a policy using it now denies access rather
-- than granting it. S1-07 replaces the body in its own migration.
-- ---------------------------------------------------------------------------
create or replace function public.auth_is_member(circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- TODO(S1-07): replace with
  --   select exists (
  --     select 1 from public.circle_members m
  --     where m.circle_id = auth_is_member.circle_id
  --       and m.user_id = (select auth.uid())
  --       and m.status = 'active'
  --   );
  select false;
$$;

comment on function public.auth_is_member(uuid) is
  'True when the caller is an active member of the circle. Stub returning false until S1-07 creates circle_members; fails closed by design.';

revoke all on function public.auth_is_member(uuid) from public;
grant execute on function public.auth_is_member(uuid) to anon, authenticated;
