-- Local seed. Runs on `supabase db reset`, never in a deployed environment.
--
-- pgTAP is created here rather than in a migration deliberately: the test
-- harness needs it, and production has no business carrying a testing
-- extension it will never call.
create extension if not exists pgtap with schema extensions;

-- Scenario data — three circles including incomplete responses and a quiet ask
-- (architecture §7.1) — arrives with the tables in Slice 1. There is nothing to
-- seed until then.
