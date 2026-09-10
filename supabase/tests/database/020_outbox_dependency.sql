-- A tripwire, not a test of this migration.
--
-- Two functions owe `jobs.outbox` events in the same transaction as their write
-- (architecture §6.3): `public.create_circle` owes `circles.circle_created` and
-- `circles.member_joined`, and `planning.transition_plan` owes a `planning.*`
-- event for every action it applies. Neither writes them, because `jobs.outbox`
-- does not exist yet: it lands in S1-11, which both S1-07 and S1-08 block, so
-- the ordering cannot be the other way round.
--
-- A TODO in the function body would be a note that nobody reads on the day it
-- matters. This fails the build the moment the table appears, with the fix in
-- the failure message.

begin;
select plan(1);

select is(
  (select count(*)::integer
   from information_schema.tables
   where table_schema = 'jobs' and table_name = 'outbox'),
  0,
  'jobs.outbox does not exist yet — when this fails, S1-11 has landed: '
  'add the event inserts to public.create_circle and planning.transition_plan, '
  'assert them here instead of this tripwire, and delete this file'
);

select * from finish();
rollback;
