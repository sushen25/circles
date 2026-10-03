-- ---------------------------------------------------------------------------
-- Locking in a time the organiser chose themselves (ADR 0050).
--
-- A wrapper over `planning.transition_plan(plan, 'confirm_own', …)`, as
-- `confirm_meetup` is for an option, and for the same reasons: `planning` is not
-- reachable by a client, and the actor must be `auth.uid()` rather than an
-- argument. The machine does the rest under the plan's lock: the organiser
-- guard, the stretch being a valid one (`private.own_time_problem`), the frozen
-- confirmation, who is going, and `confirmation.meetup_confirmed`.
--
-- **Freezing only what the organiser saw.** A candidate lock-in names the set it
-- was looking at (`expected_set_id`, ADR 0018). An own time has no set, so it
-- names the plan's `input_version`, which every answer moves. If somebody
-- answered while the organiser was looking, the names on the screen are not the
-- names that would be frozen, and the request is refused as `stale_availability`
-- so the screen can update and ask again. Null first and on its own, for the
-- reason `confirm_meetup` has: a caller who names no version was not looking at
-- one.
--
-- The plan's own state is checked ahead of the version, so a cancelled plan says
-- so rather than saying its names are out of date.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_own_time(
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  -- The plan's input version as `stretch_availability` returned it with the
  -- names the organiser was shown.
  p_expected_input_version integer,
  -- "Did you have to chase anyone outside the app?" (spec §5.10), required as in
  -- `confirm_meetup`: this function is granted to `authenticated` too, and the
  -- evidence for H2 is not optional because of the door somebody came through.
  p_chased_answer text,
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
  confirmation public.meetup_confirmations;
begin
  if caller is null then
    raise exception 'confirm_own_time requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into plan from public.plans p where p.id = p_plan_id for update;
  -- Membership before anything that can be observed, and a non-member gets the
  -- answer a plan that is not there would get (see `confirm_meetup`).
  if not found or not public.auth_is_member(plan.circle_id) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if plan.organiser_user_id is distinct from caller then
    raise exception 'not_the_organiser' using errcode = 'P0001';
  end if;

  if p_chased_answer is null or p_chased_answer not in ('none', 'one', 'more') then
    raise exception 'chased_answer_required' using errcode = 'P0001';
  end if;

  if plan.state not in ('collecting', 'ready') then
    raise exception '%', case
      when plan.state in ('completed', 'expired', 'cancelled') then 'plan_is_finished'
      else 'wrong_state'
    end using errcode = 'P0001';
  end if;

  if p_expected_input_version is distinct from plan.input_version then
    raise exception 'stale_availability' using errcode = 'P0001';
  end if;

  perform planning.transition_plan(
    p_plan_id,
    'confirm_own',
    caller,
    jsonb_strip_nulls(jsonb_build_object(
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'place_name', p_place_name,
      'place_url', p_place_url,
      'note', p_note,
      'chased_answer', p_chased_answer
    ))
  );

  select * into confirmation
  from public.meetup_confirmations c
  where c.plan_id = plan.id and c.revision = plan.revision and c.status = 'active';

  return confirmation;
end;
$$;

comment on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) is
  'Locks in a time the calling organiser chose, through planning.transition_plan, and refuses it as stale_availability when an answer arrived since the names they were shown (ADR 0050).';

revoke all on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) from public;
revoke all on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) from anon, authenticated;
grant execute on function public.confirm_own_time(uuid, timestamptz, timestamptz, integer, text, text, text, text) to authenticated;
