create or replace function jobs.on_member_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform jobs.emit('circles.member_joined', 'circle', new.circle_id, jsonb_build_object(
      'circle_id', new.circle_id,
      'user_id', new.user_id,
      'role', new.role
    ));
  elsif new.status = 'removed' and old.status <> 'removed' then
    perform jobs.emit('circles.member_removed', 'circle', new.circle_id, jsonb_build_object(
      'circle_id', new.circle_id,
      'user_id', new.user_id
    ));
  end if;
  return new;
end;
$$;

revoke all on function jobs.on_member_changed() from public;
revoke all on function jobs.on_member_changed() from anon, authenticated;
