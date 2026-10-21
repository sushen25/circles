-- ---------------------------------------------------------------------------
-- Leaving a circle (spec §4.5, §13; S4-05, ADR 0083).
--
-- Any active member, guests included, takes themselves out: the owner's Remove
-- done by the person it is done to. `public.on_member_removed` decides what
-- follows exactly as it does for the owner's Remove, so a leaver's answers to
-- plans still asking go, those plans' input versions are bumped, and the
-- function returns them for the caller to recalculate.
--
-- The owner cannot leave. A circle has an owner while it is active, and handing
-- it on is not this operation; an owner who wants out deletes their account,
-- which does hand it on (or archives it) after asking.
--
-- The name stays on the row, as it does after a Remove: history the circle's
-- other members saw ("Sam said they were free") reads the same afterwards.
-- ---------------------------------------------------------------------------

create or replace function public.leave_circle(p_circle_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  stale uuid[];
begin
  if caller is null then
    raise exception 'leave_circle requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.circles c where c.id = p_circle_id for update;

  if exists (
    select 1 from public.circles c where c.id = p_circle_id and c.owner_user_id = caller
  ) then
    raise exception 'owner_cannot_leave' using errcode = 'check_violation';
  end if;

  update public.circle_members m
  set status = 'removed', updated_at = now()
  where m.circle_id = p_circle_id and m.user_id = caller and m.status = 'active';

  if not found then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- The plans they organise go on, as they do when an account is deleted: a
  -- named plan whose organiser has left would otherwise be nobody's.
  perform private.hand_on_plans(caller, p_circle_id);

  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_left', 'circle', p_circle_id, '{}'::jsonb);

  select coalesce(array_agg(p.id order by p.created_at), '{}'::uuid[]) into stale
  from public.plans p
  where p.circle_id = p_circle_id and p.state in ('collecting', 'ready');

  return stale;
end;
$$;

comment on function public.leave_circle(uuid) is
  'The caller takes themselves out of a circle, as the owner''s Remove would; returns the plans to recalculate. Refused for the owner (S4-05).';

revoke all on function public.leave_circle(uuid) from public;
revoke all on function public.leave_circle(uuid) from anon, authenticated;
grant execute on function public.leave_circle(uuid) to authenticated;
