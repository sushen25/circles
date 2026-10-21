-- ---------------------------------------------------------------------------
-- A person is leaving a circle, and the plans they organise go on (S4-05,
-- ADR 0083). Used by `public.delete_account` and `public.leave_circle`, so the
-- two cannot disagree.
--
-- A named plan that still has a future goes to the longest-standing member who
-- could organise one (active, a saved place, a participant of the current
-- revision), or to nobody: a plan with no organiser is already a legal state.
-- A quiet plan always goes to nobody, because its role is one somebody
-- *accepts* (`accept_organiser`) and is never given. Nothing is cancelled.
-- ---------------------------------------------------------------------------

create or replace function private.hand_on_plans(p_user_id uuid, p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mine record;
  next_organiser uuid;
begin
  for mine in
    select p.id, p.revision, p.mode
    from public.plans p
    where p.circle_id = p_circle_id
      and p.organiser_user_id = p_user_id
      and p.state in ('collecting', 'ready', 'confirmed')
    order by p.id
  loop
    next_organiser := null;
    if mine.mode = 'named' then
      select m.user_id into next_organiser
      from public.circle_members m
      join public.profiles pr on pr.user_id = m.user_id
      join public.plan_participants pp
        on pp.plan_id = mine.id and pp.revision = mine.revision and pp.user_id = m.user_id
      where m.circle_id = p_circle_id and m.status = 'active'
        and m.user_id <> p_user_id and pr.is_permanent
      order by m.joined_at, m.user_id
      limit 1;
    end if;
    update public.plans set organiser_user_id = next_organiser where id = mine.id;
  end loop;
end;
$$;

comment on function private.hand_on_plans(uuid, uuid) is
  'The named plans a leaving person organises in one circle go to an eligible participant or to nobody; quiet plans to nobody (S4-05, ADR 0083).';

revoke all on function private.hand_on_plans(uuid, uuid) from public;
revoke all on function private.hand_on_plans(uuid, uuid) from anon, authenticated;
