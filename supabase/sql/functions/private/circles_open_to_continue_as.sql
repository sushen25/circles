-- ---------------------------------------------------------------------------
-- The circle (if any) a short code may still be used to Continue-as in
-- (spec §5.1, ADR 0049, ADR 0059).
--
-- A code is not a key forever. ADR 0006 accepted that Continue-as needs no
-- owner approval, and ADR 0022 accepted a plan code in URLs and logs because it
-- "admits for days, not for good" — so the list a code opens has to stop with
-- the code's life, and this is the one place that says when:
--
--   * a **plan** code: while the circle is `active` and the plan is
--     `collecting` or `ready`, or has been locked in (`confirmed`, and
--     `completed` once the outcome is in) and its meetup ended less than
--     `private.continue_as_window()` ago. `completed` is the same plan the
--     morning after: refusing it would shut the people who come back to say
--     "I was there" out the moment the organiser answered the question.
--     `private.plan_live_for_continue_as` holds that rule;
--   * **nothing else**. A circle's own code resolves to nothing (ADR 0059): it
--     is readable by every member for as long as they are one, no link the
--     product shares carries it, and nothing rotates it, so a member removed
--     from the circle could keep using it for ever. Neither does a `cancelled`
--     or `expired` plan, a quiet ask that has not found its footing (`draft`,
--     `seeking`: never shared by link, §5.4), or an archived circle.
--
-- Empty for a code that matches none of these, and the caller cannot tell
-- "unknown" from "no longer live", which is the point.
-- ---------------------------------------------------------------------------

create or replace function private.circles_open_to_continue_as(p_short_code text)
returns setof uuid
-- plpgsql, not sql, so the functions it reads are looked up when this runs and not when
-- it is created: the generated block renders files in name order, and this one
-- sorts before the ones it reads.
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select pl.circle_id
  from public.plans pl
  where pl.short_code = p_short_code
    and private.plan_live_for_continue_as(pl.id);
end;
$$;

revoke all on function private.circles_open_to_continue_as(text) from public;
revoke all on function private.circles_open_to_continue_as(text) from anon, authenticated;
