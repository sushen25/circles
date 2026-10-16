-- The whole catalogue, asserted at once (SUS-124).
--
-- Every other file here proves one table or one function. These assertions
-- are about *all of them*, so the day somebody adds a table without row-level
-- security, a `security definer` function that does not pin its search path,
-- or a function `public` can execute, this file fails, naming it. They read the
-- catalogue and fix nothing: the repair belongs in the migration that added
-- the object.
--
-- The five schemas are the ones this repository creates. Objects that belong
-- to an extension (`pg_depend` type 'e') are not ours and are left out.
-- Nothing is excused today; if a future object has to be, name it in
-- `exceptions` below with the ticket that removes it.

begin;
select plan(11);

create temp table ours on commit drop as
select n.nspname as schema_name, c.oid, c.relname, c.relkind, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private', 'jobs', 'analytics', 'planning')
  and c.relkind in ('r', 'p')
  and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');

create temp table our_functions on commit drop as
select n.nspname as schema_name, p.oid,
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
       p.prosecdef, p.proconfig, p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private', 'jobs', 'analytics', 'planning')
  and p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

-- Exceptions: (kind, name, ticket). Empty on purpose.
create temp table exceptions (kind text, name text, ticket text) on commit drop;

-- A query that matched nothing would pass every check below, so the catalogue
-- is shown to be read first.
select ok((select count(*) from ours) > 20, 'the catalogue query sees the tables');
select ok((select count(*) from our_functions) > 100, 'and the functions');
select is(
  (select count(distinct schema_name) from ours), 5::bigint, 'and every one of the five schemas has a table'
);

-- Row-level security -------------------------------------------------------

select is(
  coalesce((select array_agg(schema_name || '.' || relname order by schema_name, relname)
            from ours
            where not relrowsecurity
              and not exists (select 1 from exceptions e
                              where e.kind = 'rls' and e.name = schema_name || '.' || relname)),
           array[]::text[]),
  array[]::text[],
  'every table in public, private, jobs, analytics and planning has row-level security enabled'
);
select is(
  (select relrowsecurity from ours where schema_name = 'planning' and relname = 'transitions'),
  true,
  'planning.transitions among them (it was the one that did not)'
);

-- Definer functions pin their search path ----------------------------------

select is(
  coalesce((select array_agg(signature order by signature)
            from our_functions f
            where prosecdef
              and not exists (select 1 from unnest(proconfig) c where c like 'search_path=%')
              and not exists (select 1 from exceptions e where e.kind = 'search_path' and e.name = f.signature)),
           array[]::text[]),
  array[]::text[],
  'every security definer function sets search_path'
);
select ok(
  (select count(*) from our_functions where prosecdef) > 50, 'and there are definer functions for that to be about'
);
select is(
  coalesce((select array_agg(signature order by signature)
            from our_functions f
            where prosecdef
              and exists (select 1 from unnest(proconfig) c where c ~ '^search_path=.*(public|\$user)')
              and not exists (select 1 from exceptions e where e.kind = 'search_path_public' and e.name = f.signature)),
           array[]::text[]),
  array[]::text[],
  'and none of them puts public (or $user) on that path: an empty path, or a named schema'
);

-- Nothing is executable by public ------------------------------------------

select is(
  coalesce((select array_agg(signature order by signature)
            from our_functions f
            where (proacl is null
                   or exists (select 1 from aclexplode(proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
              and not exists (select 1 from exceptions e where e.kind = 'public_execute' and e.name = f.signature)),
           array[]::text[]),
  array[]::text[],
  'no function in the five schemas is executable by public'
);

-- Client roles never get a bare table ---------------------------------------

select is(
  coalesce((select array_agg(schema_name || '.' || relname order by schema_name, relname)
            from ours
            where schema_name in ('private', 'jobs', 'analytics', 'planning')
              and (has_table_privilege('anon', oid, 'select,insert,update,delete')
                   or has_table_privilege('authenticated', oid, 'select,insert,update,delete'))),
           array[]::text[]),
  array[]::text[],
  'no table in private, jobs, analytics or planning is readable or writable by anon or authenticated'
);

-- The minute job -------------------------------------------------------------
-- 080_retention.sql proves what the invoker sends. What it cannot reach is
-- pg_cron itself, which runs the job in a background worker outside any
-- transaction; so what is asserted here is the schedule row it would run.

select is(
  (select schedule from cron.job where jobname = 'process-jobs'),
  '* * * * *',
  'the dispatcher is scheduled every minute'
);

select * from finish();
rollback;
