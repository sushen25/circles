-- ---------------------------------------------------------------------------
-- The circle (if any) a short code may still be used to Continue-as in
-- (spec §5.1, ADR 0048).
--
-- A code is not a key forever. ADR 0006 accepted that Continue-as needs no
-- owner approval, and ADR 0022 accepted a plan code in URLs and logs because it
-- "admits for days, not for good" — so the list a code opens has to stop with
-- the code's life, and this is the one place that says when:
--
--   * a **circle** code: while the circle is `active`;
--   * a **plan** code: while the circle is `active` and the plan is
--     `collecting` or `ready`, or has been locked in (`confirmed`, and
--     `completed` once the outcome is in) and its meetup ended less than
--     `private.continue_as_window()` ago. `completed` is the same plan the
--     morning after: refusing it would shut the people who come back to say
--     "I was there" out the moment the organiser answered the question;
--   * never for a `cancelled` or `expired` plan, nor for a quiet ask that has
--     not found its footing (`draft`, `seeking`: those are never shared by
--     link, §5.4), nor for an archived circle.
--
-- Empty for a code that matches none of these, and the caller cannot tell
-- "unknown" from "no longer live", which is the point.
-- ---------------------------------------------------------------------------

create or replace function private.circles_open_to_continue_as(p_short_code text)
returns setof uuid
-- plpgsql, not sql, so `continue_as_window` is looked up when this runs and not when
-- it is created: the generated block renders files in name order, and this one
-- sorts before the function it reads.
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select c.id
  from public.circles c
  where c.short_code = p_short_code and c.status = 'active'
  union
  select c.id
  from public.plans pl
  join public.circles c on c.id = pl.circle_id
  where pl.short_code = p_short_code
    and c.status = 'active'
    and (
      pl.state in ('collecting', 'ready')
      or (
        pl.state in ('confirmed', 'completed')
        and exists (
          select 1 from public.meetup_confirmations mc
          where mc.plan_id = pl.id
            and mc.revision = pl.revision
            and mc.status in ('active', 'completed')
            and now() < mc.ends_at + private.continue_as_window()
        )
      )
    );
end;
$$;

revoke all on function private.circles_open_to_continue_as(text) from public;
revoke all on function private.circles_open_to_continue_as(text) from anon, authenticated;
