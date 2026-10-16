-- 0063_planning_transitions_rls
--
-- `planning.transitions` is the one table in the five schemas the app owns
-- that had row-level security off. No client role could reach it anyway
-- (no grant, and no usage on `planning`), but "unreachable by grant" is one
-- lock and the rest of the catalogue has two. With RLS on and no policy it is
-- closed to every role that does not own it; the `security definer`
-- functions that read it run as its owner, which RLS does not apply to, so
-- nothing that works today changes.
--
-- The catalogue test `supabase/tests/database/490_catalogue.sql` is what holds
-- this: a table added to any of the five schemas without RLS fails it.

alter table planning.transitions enable row level security;
