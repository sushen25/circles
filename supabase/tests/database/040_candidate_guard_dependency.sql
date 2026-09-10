-- A tripwire, like 020.
--
-- `planning.transition_plan`'s `candidate` guard checks that a candidate id was
-- *supplied*, not that it names a currently eligible candidate. The domain's
-- guard checks the second thing, because a candidate can stop being eligible
-- between the organiser opening the review screen and tapping the button — and
-- §6.4 says a transition guard is authoritative in Postgres, not only in
-- TypeScript.
--
-- The real check needs `public.candidates`, which lands in S1-09. This fails the
-- build the moment that table exists.

begin;
select plan(1);

select is(
  (select count(*)::integer
   from information_schema.tables
   where table_schema = 'public' and table_name = 'candidates'),
  0,
  'public.candidates does not exist yet — when this fails, S1-09 has landed: '
  'tighten the candidate guard in planning.transition_plan to require the id to '
  'name a row in the plan''s current candidate set (matching revision, '
  'input_version and scoring_version), assert it in 030_planning.sql, and '
  'delete this file'
);

select * from finish();
rollback;
