-- One row per answer: `replace_response` upserts the response row exactly
-- once per call (0004), so this is one event per answer, not one per window.
-- A deleted answer is a cleared one — removal deletes them (§4.5) — unless
-- the plan itself is going, in which case there is nobody left to tell.

create or replace function jobs.on_response_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.plans p where p.id = old.plan_id) then
      perform jobs.emit('availability.response_cleared', 'plan', old.plan_id, jsonb_build_object(
        'plan_id', old.plan_id,
        'revision', old.revision,
        'user_id', old.user_id
      ));
    end if;
    return old;
  end if;
  -- An update that changes only *who owns* the answer is not an answer.
  -- `reattach_member` and `claim_identity` rewrite `user_id` when somebody comes
  -- back on a new device or saves their place, and emitting here told the circle
  -- they had answered again — a second "Priya answered" for a reply she made
  -- yesterday, and a second row in the analytics that measures replies.
  if tg_op = 'UPDATE'
    and new.status = old.status
    and new.used_calendar_overlay = old.used_calendar_overlay
    and new.submitted_at = old.submitted_at
  then
    return new;
  end if;

  perform jobs.emit('availability.response_submitted', 'plan', new.plan_id, jsonb_build_object(
    'plan_id', new.plan_id,
    'revision', new.revision,
    'user_id', new.user_id,
    'status', new.status,
    'used_calendar_overlay', new.used_calendar_overlay
  ));
  return new;
end;
$$;

revoke all on function jobs.on_response_changed() from public;
revoke all on function jobs.on_response_changed() from anon, authenticated;
