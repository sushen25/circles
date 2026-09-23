-- ---------------------------------------------------------------------------
-- Removing somebody from a circle (spec §5.2, §4.5; S1-23).
--
-- "The owner can remove a member … without disturbing existing members." The
-- owner's alone, and never the owner themselves: a circle is owned by one of
-- its members (`enforce_owner_stays_member`), and handing it on is its own
-- operation.
--
-- This function decides *whether*; `public.on_member_removed` decides *what
-- follows*, and it is a trigger on the row so that every writer of
-- `status = 'removed'` gets the same consequences: their answers to plans still
-- asking go, they leave those plans' participant lists, a `ready` plan they
-- helped make ready goes back to collecting, and a meetup still ahead stops
-- counting them as going. `jobs.on_member_changed` emits
-- `circles.member_removed`. Access ends with the statement: every policy is
-- written against `auth_is_member`, which reads `status`.
--
-- What it returns is the other half of "excluded from the next recalculation":
-- the plans whose candidate sets the removal has made stale. The trigger bumps
-- their input version, so no set computed with the departed member can be
-- confirmed; `remove-member` then runs the engine on each in the same request
-- (ADR 0018), so the organiser sees the options without them straight away.
--
-- The circle row is locked first — the order `create_plan` and the trigger lock
-- in — so a removal racing a new plan cannot leave the member on its roster.
-- ---------------------------------------------------------------------------

create or replace function public.remove_member(p_circle_id uuid, p_user_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_status text;
  stale uuid[];
begin
  if caller is null then
    raise exception 'remove_member requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.circles c where c.id = p_circle_id for update;

  if not public.auth_is_owner(p_circle_id) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  if p_user_id = caller then
    raise exception 'cannot_remove_owner' using errcode = 'check_violation';
  end if;

  select m.status into target_status
  from public.circle_members m
  where m.circle_id = p_circle_id and m.user_id = p_user_id
  for update;

  -- Somebody already removed, and somebody never in it, are the same answer:
  -- there is nobody active by that id to remove.
  if target_status is distinct from 'active' then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  update public.circle_members m
  set status = 'removed', updated_at = now()
  where m.circle_id = p_circle_id and m.user_id = p_user_id;

  -- Who removed whom is a fact the owner may need later ("why can't Sam see
  -- the plan?"). Ids only, like every row here.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_removed', 'circle', p_circle_id,
          jsonb_build_object('user_id', p_user_id));

  select coalesce(array_agg(p.id order by p.created_at), '{}'::uuid[]) into stale
  from public.plans p
  where p.circle_id = p_circle_id and p.state in ('collecting', 'ready');

  return stale;
end;
$$;

comment on function public.remove_member(uuid, uuid) is
  'Removes an active member from a circle, as its owner; returns the plans whose candidates must be recalculated without them (spec §5.2, §4.5).';

revoke all on function public.remove_member(uuid, uuid) from public;
revoke all on function public.remove_member(uuid, uuid) from anon, authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
