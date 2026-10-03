-- ---------------------------------------------------------------------------
-- Editing a locked-in plan: its time, its place and its note (ADR 0051).
--
-- "Edit this plan" on the confirmed screen. Three things can change, and the
-- difference between them is the whole of the design:
--
--   * **The place or the note alone** updates the active confirmation in place
--     (`edit_confirmed`). Nobody's status changes, nobody is emailed, and
--     everyone sees it straight away.
--   * **The time** is a move (`move_confirmed`): the active confirmation is
--     superseded for the reason `move` and a new one is written in the same
--     revision. Who is going is derived again, the reminder and the calendar
--     entry follow the new time, and the plan's members are told once.
--   * Neither asks anybody to answer again: that is "Ask for new times" (the old
--     "Change the time", `reopen`), which opens a new revision and is not here.
--
-- The place and note are said **whole**: what the screen now shows, with a null
-- clearing one. A save that moves the time and changes the place is one move. A
-- save that changes nothing is refused as `nothing_to_change`, so a repeated
-- request is not a second move.
--
-- A move names the plan's `input_version` the way `confirm_own_time` does, and
-- for the same reason; an edit that leaves the time alone does not need it,
-- because it freezes no names.
-- ---------------------------------------------------------------------------

create or replace function public.edit_confirmation(
  p_plan_id uuid,
  -- The new time, both ends, or neither to leave it where it is.
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_expected_input_version integer,
  p_place_name text default null,
  p_place_url text default null,
  p_note text default null
)
returns public.meetup_confirmations
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  plan public.plans;
  active public.meetup_confirmations;
  moving boolean;
  details jsonb;
begin
  if caller is null then
    raise exception 'edit_confirmation requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if plan.state <> 'confirmed' then
    raise exception '%', case
      when plan.state in ('completed', 'expired', 'cancelled') then 'plan_is_finished'
      else 'wrong_state'
    end using errcode = 'P0001';
  end if;

  select * into active from public.meetup_confirmations c
  where c.plan_id = plan.id and c.revision = plan.revision and c.status = 'active';
  if not found then
    raise exception 'confirmation_not_active' using errcode = 'P0001';
  end if;

  -- Both ends or neither: half a stretch is not a time.
  if (p_starts_at is null) <> (p_ends_at is null) then
    raise exception 'needs_own_time' using errcode = 'P0001';
  end if;
  moving := p_starts_at is not null
    and (p_starts_at, p_ends_at) is distinct from (active.starts_at, active.ends_at);

  if not moving
     and p_place_name is not distinct from active.place_name
     and p_place_url is not distinct from active.place_url
     and p_note is not distinct from active.note then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;

  -- Whole, with a null clearing: `jsonb_build_object` keeps the keys, which is
  -- what tells a cleared note from one nobody mentioned.
  details := jsonb_build_object(
    'place_name', p_place_name, 'place_url', p_place_url, 'note', p_note
  );

  if moving then
    if p_expected_input_version is distinct from plan.input_version then
      raise exception 'stale_availability' using errcode = 'P0001';
    end if;
    perform planning.transition_plan(
      p_plan_id, 'move_confirmed', caller,
      details || jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at)
    );
  else
    perform planning.transition_plan(p_plan_id, 'edit_confirmed', caller, details);
  end if;

  select * into active from public.meetup_confirmations c
  where c.plan_id = plan.id and c.revision = plan.revision and c.status = 'active';
  return active;
end;
$$;

comment on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) is
  'The calling organiser edits a locked-in plan: a new time is a move (supersede and write a new active confirmation, same revision), a place or note alone updates it in place. Nobody is asked again (ADR 0051).';

revoke all on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) from public;
revoke all on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) from anon, authenticated;
grant execute on function public.edit_confirmation(uuid, timestamptz, timestamptz, integer, text, text, text) to authenticated;
