create or replace function jobs.on_member_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A join is a membership becoming active, not only a row appearing. A removed
  -- member who redeems a live link joins again (`redeem_invite`), and that is
  -- the same event to everybody downstream: the owner is told, the roster
  -- changes, the dispatcher counts a new non-responder. Emitting only on INSERT
  -- made the second join silent.
  --
  -- The INSERT arm now asks for `active` as well, which it never used to. An
  -- insert that lands `removed` is nobody joining; it was unreachable in
  -- practice, and a trigger that says "joined" for it is a trigger that will one
  -- day be right about nothing.
  if (tg_op = 'INSERT' and new.status = 'active')
    or (tg_op = 'UPDATE' and new.status = 'active' and old.status <> 'active') then
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
