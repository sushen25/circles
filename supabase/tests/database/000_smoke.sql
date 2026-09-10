-- The privacy invariant, asserted rather than assumed.
--
-- Spec §10 and the manifesto both say privacy is structural: raw calendar
-- events cannot reach the network and quiet-ask identities cannot be selected
-- *because the database makes it impossible*, not because someone remembered.
-- This is the first test of that claim, and it runs on every `pnpm db:test`.

begin;
select plan(14);

-- The schemas exist and are named what everything else expects.
select has_schema('public', 'public schema exists');
select has_schema('private', 'private schema exists');
select has_schema('analytics', 'analytics schema exists');
select has_schema('jobs', 'jobs schema exists');

-- Neither client role may even look inside the three private schemas.
select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot use the private schema'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated cannot use the private schema'
);
select ok(
  not has_schema_privilege('anon', 'analytics', 'usage'),
  'anon cannot use the analytics schema'
);
select ok(
  not has_schema_privilege('authenticated', 'analytics', 'usage'),
  'authenticated cannot use the analytics schema'
);
select ok(
  not has_schema_privilege('anon', 'jobs', 'usage'),
  'anon cannot use the jobs schema'
);
select ok(
  not has_schema_privilege('authenticated', 'jobs', 'usage'),
  'authenticated cannot use the jobs schema'
);

-- The extensions the product relies on, and where they live.
select has_extension('extensions', 'pgcrypto', 'pgcrypto is installed outside public');
select has_extension('extensions', 'btree_gist', 'btree_gist is installed outside public');

-- The helper every RLS policy will be written against.
select has_function(
  'public', 'auth_is_member', array['uuid'],
  'auth_is_member(uuid) exists for RLS policies to use'
);
select is(
  public.auth_is_member('00000000-0000-0000-0000-000000000000'::uuid),
  false,
  'auth_is_member says no for a circle that does not exist'
);

select * from finish();
rollback;
