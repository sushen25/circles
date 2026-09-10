-- A tripwire, not a test of this migration.
--
-- Four writers owe `jobs.outbox` events in the same transaction as their write
-- (architecture §6.3): `public.create_circle` owes `circles.circle_created` and
-- `circles.member_joined`; `planning.transition_plan` owes a `planning.*` event
-- for every action it applies; `public.replace_response` owes
-- `availability.response_submitted`; and an attendance change owes
-- `confirmation.attendance_updated`, from a trigger on `public.attendance`.
-- None writes them, because `jobs.outbox` does not exist yet: it lands in
-- S1-11, which S1-07 through S1-10 all block, so the ordering cannot be the
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
  'add the event inserts to create_circle, transition_plan, replace_response and an attendance trigger, '
  'assert them here instead of this tripwire, and delete this file'
);

select * from finish();
rollback;
