-- The cap, in one place. Twenty (ADR 0012); the domain's `memberLimits.max`
-- is the other copy, and `010_circles.sql` fills a circle to exactly this many.

create or replace function public.member_cap()
returns integer
language sql
immutable
as $$ select 20 $$;

comment on function public.member_cap() is
  'Maximum active members in a circle (ADR 0012). Mirrors memberLimits.max in packages/domain/src/circles/quorum.ts.';

revoke all on function public.member_cap() from public;
revoke all on function public.member_cap() from anon, authenticated;
