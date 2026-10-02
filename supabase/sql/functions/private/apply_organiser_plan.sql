-- ---------------------------------------------------------------------------
-- What the organiser setting the final plan does to the confirmation
-- (ADR 0050), in the transaction `planning.transition_plan` has already opened
-- under the plan's row lock.
--
--   * `confirm_own` writes the first confirmation, for a stretch that is not in
--     any candidate set: `own_time`, and `below_quorum` when fewer can make it
--     than the plan asked for. Nothing about the plan's number moves.
--   * `move_confirmed` supersedes the active confirmation for the reason `move`
--     and writes a new active one in the **same revision**, so "Friday was moved"
--     stays true in the record and a revision still has at most one active
--     confirmation. The new row says where it moved from, keeps the calendar
--     entry's identity with a higher sequence, and carries the old row's survey
--     answer: that question is asked once per plan, at the first lock-in.
--   * `edit_confirmed` updates the place and note of the active row in place.
--     Nobody's status changes and nothing is written beside it.
--
-- **Who is going** is `deriveAttendance` for an own time: going for anybody whose
-- times cover the stretch or who said "I'm easy" (`private.stretch_availability`,
-- the same rule the picker showed), and everybody else *to confirm*, whether
-- they answered or not. Never "can't make it": they never said no to a time the
-- organiser chose knowing the answers (manifesto §3.5). A move derives it again
-- from this revision's answers, and the old rows stay as history, so a status
-- somebody set by hand for the old time does not carry over.
--
-- Returns the id of the active confirmation.
-- ---------------------------------------------------------------------------

create or replace function private.apply_organiser_plan(
  p_plan public.plans,
  p_action text,
  p_actor uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts timestamptz := (p_payload ->> 'starts_at')::timestamptz;
  ends timestamptz := (p_payload ->> 'ends_at')::timestamptz;
  old public.meetup_confirmations;
  stretch jsonb;
  available uuid[];
  confirmation_id uuid;
begin
  if p_action = 'edit_confirmed' then
    select * into old from public.meetup_confirmations c
    where c.plan_id = p_plan.id and c.revision = p_plan.revision and c.status = 'active'
    for update;
    if not found then
      raise exception 'confirmation_not_active' using errcode = 'P0001';
    end if;
    if old.ends_at <= now() then
      raise exception 'meetup_has_ended' using errcode = 'P0001';
    end if;

    update public.meetup_confirmations c
    set place_name = case when p_payload ? 'place_name' then p_payload ->> 'place_name' else c.place_name end,
        place_url = case when p_payload ? 'place_url' then p_payload ->> 'place_url' else c.place_url end,
        note = case when p_payload ? 'note' then p_payload ->> 'note' else c.note end
    where c.id = old.id;
    return old.id;
  end if;

  stretch := private.stretch_availability(p_plan.id, starts, ends);
  available := coalesce(
    (select array_agg(e::uuid order by o)
     from jsonb_array_elements_text(stretch -> 'available') with ordinality as t (e, o)),
    array[]::uuid[]
  );

  if p_action = 'confirm_own' then
    insert into public.meetup_confirmations (
      plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids,
      place_name, place_url, note, chased_answer, confirmed_by, own_time, below_quorum
    ) values (
      p_plan.id, p_plan.revision,
      to_char(starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      starts, ends, available,
      p_payload ->> 'place_name', p_payload ->> 'place_url', p_payload ->> 'note',
      p_payload ->> 'chased_answer', p_actor,
      true, cardinality(available) < p_plan.quorum
    ) returning id into confirmation_id;
  else
    select * into old from public.meetup_confirmations c
    where c.plan_id = p_plan.id and c.revision = p_plan.revision and c.status = 'active'
    for update;
    if not found then
      raise exception 'confirmation_not_active' using errcode = 'P0001';
    end if;
    if old.ends_at <= now() then
      raise exception 'meetup_has_ended' using errcode = 'P0001';
    end if;

    update public.meetup_confirmations c
    set status = 'superseded', superseded_at = now(), superseded_reason = 'move'
    where c.id = old.id;

    insert into public.meetup_confirmations (
      plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids,
      place_name, place_url, note, chased_answer, confirmed_by, own_time, below_quorum,
      moved_from_starts_at, moved_from_ends_at, calendar_uid, calendar_sequence
    ) values (
      p_plan.id, p_plan.revision,
      to_char(starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      starts, ends, available,
      case when p_payload ? 'place_name' then p_payload ->> 'place_name' else old.place_name end,
      case when p_payload ? 'place_url' then p_payload ->> 'place_url' else old.place_url end,
      case when p_payload ? 'note' then p_payload ->> 'note' else old.note end,
      old.chased_answer, p_actor,
      true, cardinality(available) < p_plan.quorum,
      old.starts_at, old.ends_at, old.calendar_uid, old.calendar_sequence + 1
    ) returning id into confirmation_id;
  end if;

  -- `deriveAttendance` for an own time. Derived, not said: the marker keeps the
  -- attendance trigger from announcing the organiser's own row as a fresh answer.
  perform set_config('circles.deriving_attendance', 'on', true);
  insert into public.attendance (confirmation_id, user_id, status)
  select confirmation_id, pp.user_id,
    case when pp.user_id = any (available) then 'going' else 'unknown' end
  from public.plan_participants pp
  join public.circle_members m
    on m.circle_id = p_plan.circle_id and m.user_id = pp.user_id and m.status = 'active'
  where pp.plan_id = p_plan.id and pp.revision = p_plan.revision;
  perform set_config('circles.deriving_attendance', 'off', true);

  return confirmation_id;
end;
$$;

comment on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) is
  'The confirmation side of the organiser setting the final plan: an own time, a move (supersede and write a new active confirmation in the same revision) or a place and note edit in place. Called by transition_plan under the plan''s lock (ADR 0050).';

revoke all on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) from public;
revoke all on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) from anon, authenticated;
grant execute on function private.apply_organiser_plan(public.plans, text, uuid, jsonb) to service_role;
