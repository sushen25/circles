-- A status somebody chose. On update, one that changed: the `before` trigger
-- in 0005 turns a repeat into a no-op by returning the old row, but the
-- `after` trigger still fires, so the comparison is made again here. On
-- insert, one the member wrote themselves — a participant with no derived
-- row yet answering for the first time — which is `auth.uid()` being the row's
-- user and `transition_plan` not being in the middle of deriving; the rows it
-- derives at confirmation are not "updates" anybody made.

create or replace function jobs.on_attendance_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_id uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_op = 'INSERT' and (
    new.user_id is distinct from auth.uid()
    or coalesce(current_setting('circles.deriving_attendance', true), '') = 'on'
  ) then
    return new;
  end if;
  select c.plan_id into plan_id from public.meetup_confirmations c where c.id = new.confirmation_id;
  perform jobs.emit('confirmation.attendance_updated', 'confirmation', new.confirmation_id, jsonb_build_object(
    'confirmation_id', new.confirmation_id,
    'plan_id', plan_id,
    'user_id', new.user_id,
    'status', new.status
  ));
  return new;
end;
$$;

revoke all on function jobs.on_attendance_updated() from public;
revoke all on function jobs.on_attendance_updated() from anon, authenticated;
