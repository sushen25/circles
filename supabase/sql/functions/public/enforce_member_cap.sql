-- ---------------------------------------------------------------------------
-- The member cap, and the owner's membership.
--
-- Both are triggers rather than checks because both are statements about a
-- table, not about a row.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_member_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- `for update` on the circle serialises concurrent joins: two people
  -- redeeming the last seat at once would otherwise both count eleven.
  perform 1 from public.circles where id = new.circle_id for update;

  select count(*) into active_count
  from public.circle_members
  where circle_id = new.circle_id
    and status = 'active'
    and (tg_op = 'INSERT' or user_id <> new.user_id);

  if active_count >= public.member_cap() then
    raise exception 'circle % already has the maximum of % active members',
      new.circle_id, public.member_cap()
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_member_cap() is
  'Holds a circle to member_cap() active members (ADR 0012). A trigger rather than a check because the rule is about the table, not the row.';

revoke all on function public.enforce_member_cap() from public;
revoke all on function public.enforce_member_cap() from anon, authenticated;
