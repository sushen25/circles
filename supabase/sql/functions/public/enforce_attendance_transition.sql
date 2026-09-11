-- ---------------------------------------------------------------------------
-- Attendance transitions.
--
-- Mirrors `updateAttendance` / `applyAttendance` in the domain, rule for rule:
--
--   * before the meetup, `going` and `cant` swap freely; after it, `was_there`
--     and `missed` swap freely; nothing goes back from an answer about the
--     past to a promise about the future;
--   * a retrospective status is refused before the meetup has ended — "I was
--     there" before Thursday is not an early answer, it is a false one, and
--     `corroboration` would go on to count it;
--   * the same status twice is a no-op, not a fresh answer: the confirmed
--     screen orders by `updated_at`, and a duplicate tap must not announce a
--     change of mind nobody made;
--   * only a participant of the confirmation's revision has a row, and only on
--     a confirmation that is active or completed.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_attendance_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  confirmation public.meetup_confirmations;
  allowed text[];
begin
  select * into confirmation from public.meetup_confirmations c where c.id = new.confirmation_id;

  if confirmation.id is null then
    raise exception 'attendance_confirmation_missing' using errcode = 'foreign_key_violation';
  end if;
  if confirmation.status not in ('active', 'completed') then
    raise exception 'attendance_confirmation_not_live' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.plan_participants pp
    where pp.plan_id = confirmation.plan_id
      and pp.revision = confirmation.revision
      and pp.user_id = new.user_id
  ) then
    raise exception 'attendance_not_a_participant' using errcode = 'check_violation';
  end if;

  if new.status in ('was_there', 'missed') and now() < confirmation.ends_at then
    raise exception 'attendance_too_early' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.status = old.status then
      if new.user_id = old.user_id then
        -- Idempotent: the same answer twice. Return the old row untouched,
        -- `updated_at` included.
        return old;
      end if;

      -- Not the same answer twice — the *same answer, a different identity*.
      -- `reattach_member` and `claim_identity` rewrite `user_id` when somebody
      -- comes back on a new device or saves their place, and the answer is
      -- unchanged by definition. `return old` swallowed those updates in
      -- silence, leaving attendance owned by an identity nobody can sign in as,
      -- so "5 going" counted a person who could no longer be reached.
      --
      -- `updated_at` deliberately does not move: the confirmed screen orders by
      -- it, and nobody changed their mind. `jobs.on_attendance_updated` fires
      -- only on `status`, so nothing is announced either, which is right.
      return new;
    end if;

    allowed := case old.status
      when 'unknown' then array['going', 'cant', 'was_there', 'missed']
      when 'going' then array['cant', 'was_there', 'missed']
      when 'cant' then array['going', 'was_there', 'missed']
      when 'was_there' then array['missed']
      when 'missed' then array['was_there']
    end;
    if not (new.status = any (allowed)) then
      raise exception 'attendance_not_reversible' using errcode = 'check_violation';
    end if;

    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.enforce_attendance_transition() is
  'The attendance state machine, as updateAttendance() has it: no promise about the future after an answer about the past, no answer about the past before the meetup has ended, and a repeat is a no-op.';

revoke all on function public.enforce_attendance_transition() from public;
revoke all on function public.enforce_attendance_transition() from anon, authenticated;
