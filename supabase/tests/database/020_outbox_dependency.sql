-- A tripwire, not a test of this migration.
--
-- `create_circle` should write `circles.circle_created` and
-- `circles.member_joined` to `jobs.outbox` in the same transaction as the
-- insert (architecture §6.3). It does not, because `jobs.outbox` does not exist
-- yet: it lands in S1-11, which S1-07 blocks, so the ordering cannot be the
-- other way round.
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
  'add the circle_created and member_joined inserts to public.create_circle, '
  'assert them here instead of this tripwire, and delete this file'
);

select * from finish();
rollback;
