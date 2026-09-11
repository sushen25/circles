-- A client writes this table directly (§8.4) and cannot emit, so the row
-- announces itself: shown on insert, answered when the answer changes.

create or replace function jobs.on_nudge_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform jobs.emit('growth.nudge_shown', 'nudge', new.id, jsonb_build_object(
      'nudge_id', new.id, 'user_id', new.user_id, 'moment', new.moment, 'plan_id', new.plan_id
    ));
    if new.answer is not null then
      perform jobs.emit('growth.nudge_answered', 'nudge', new.id, jsonb_build_object(
        'nudge_id', new.id, 'user_id', new.user_id, 'moment', new.moment, 'plan_id', new.plan_id,
        'answer', new.answer
      ));
    end if;
  elsif new.answer is distinct from old.answer and new.answer is not null then
    perform jobs.emit('growth.nudge_answered', 'nudge', new.id, jsonb_build_object(
      'nudge_id', new.id, 'user_id', new.user_id, 'moment', new.moment, 'plan_id', new.plan_id,
      'answer', new.answer
    ));
  end if;
  return new;
end;
$$;

revoke all on function jobs.on_nudge_changed() from public;
revoke all on function jobs.on_nudge_changed() from anon, authenticated;
