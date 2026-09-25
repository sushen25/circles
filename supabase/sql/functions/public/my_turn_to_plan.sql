-- ---------------------------------------------------------------------------
-- Whether the caller is the one person this circle's cadence nudge asked
-- (S2-04).
--
-- Circle home shows **About time for the next one** to every member, and the
-- nudged one alone sees "it's your turn" in it (spec §5.9: one person is
-- nudged). Answered here rather than worked out on the client, because the
-- choice was made once, by the dispatcher, from switches the client cannot
-- all see — and a second calculation that disagreed would tell two people it
-- was their turn. The recipient is read from `private.cadence_prompts`, which
-- no client can select: the answer is about the caller, and only yes or no.
--
-- "This circle's nudge" is the one decided for a due date after the last
-- meetup — an older prompt belongs to a cycle the circle has since met in —
-- and it stops being the caller's when they turn nudges off: somebody who
-- said no is not then told it is their turn.
--
-- The caller's own, from `auth.uid()`, and false for anybody who is not an
-- active member: the question has no answer for them, and false says nothing.
-- ---------------------------------------------------------------------------

create or replace function public.my_turn_to_plan(p_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select true
    from public.circles c
    join public.circle_members m
      on m.circle_id = c.id and m.user_id = (select auth.uid()) and m.status = 'active'
    join private.cadence_prompts cp on cp.circle_id = c.id and cp.user_id = m.user_id
    where c.id = p_circle_id
      and c.status = 'active'
      and c.last_met_at is not null
      and cp.due_date > (c.last_met_at at time zone c.time_zone)::date
      and not m.muted_nudges
      and not m.muted_all
    limit 1
  ), false);
$$;

comment on function public.my_turn_to_plan(uuid) is
  'True when the caller, an active member, is the person this circle''s current cadence nudge asked and has not turned nudges off since. Only yes or no; never who else was asked (S2-04).';

revoke all on function public.my_turn_to_plan(uuid) from public;
revoke all on function public.my_turn_to_plan(uuid) from anon, authenticated;
grant execute on function public.my_turn_to_plan(uuid) to authenticated;
