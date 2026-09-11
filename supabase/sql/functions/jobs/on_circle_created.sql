-- ---------------------------------------------------------------------------
-- Paying the debt: the events owed since S1-07.
--
-- Two kinds of writer. A *fact about a row* — a circle exists, a member
-- joined or was removed, an answer was given, an attendance changed — is
-- announced by a trigger on the row, so every writer announces it: the
-- function that exists today, the Edge Function that inserts as the service
-- role tomorrow, and the one nobody has written yet. A *transition* is
-- announced by `transition_plan`, because only it knows which action was
-- taken — the row diff of `collecting → collecting` cannot tell an `edit`
-- from an `accept_organiser`, and deriving the action from the shape it left
-- behind is the guard-checks-the-form mistake with an event name on it.
--
-- The trigger functions are definer: a member who inserts their own
-- attendance holds nothing in `jobs`, and must not need to.
-- ---------------------------------------------------------------------------

create or replace function jobs.on_circle_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform jobs.emit('circles.circle_created', 'circle', new.id, jsonb_build_object(
    'circle_id', new.id,
    'owner_user_id', new.owner_user_id,
    'cadence', new.cadence,
    'time_zone', new.time_zone
  ));
  return new;
end;
$$;

revoke all on function jobs.on_circle_created() from public;
revoke all on function jobs.on_circle_created() from anon, authenticated;
