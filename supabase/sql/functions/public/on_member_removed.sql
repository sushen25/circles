-- ---------------------------------------------------------------------------
-- Removal: every consequence, in one trigger.
--
-- Spec §4.5 — a removed member "loses circle and plan access immediately;
-- historic aggregate attendance may remain; their availability is deleted."
-- Four things follow, and they are here together rather than in four triggers
-- because they cannot be correct separately:
--
--   * their responses and windows go — the cascade takes the windows, and the
--     bump triggers stale every candidate set that counted them;
--   * they leave the participant list of every plan revision still open, so
--     the dispatcher stops treating them as a non-responder;
--   * a `ready` plan they had answered goes back to `collecting`, because its
--     set may have needed them for quorum, and `confirm` must not lock in a
--     time that depended on somebody who has left;
--   * on a confirmation still ahead, `going` or `unknown` becomes `cant` — a
--     `going` from them would keep them in "5 going" and on the reminder list.
--     History is untouched: answers about evenings that have happened, and
--     rows on closed confirmations, stay exactly as they were.
--
-- The plan rows are locked first, so a removal racing a first answer cannot
-- let the answer land behind it.
-- ---------------------------------------------------------------------------

create or replace function public.on_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected uuid;
begin
  if new.status <> 'removed' or old.status = 'removed' then
    return new;
  end if;

  perform 1 from public.plans p where p.circle_id = new.circle_id for update;

  delete from public.plan_responses r
  using public.plans p
  where r.plan_id = p.id
    and p.circle_id = new.circle_id and r.user_id = new.user_id;

  update public.plans p
  set input_version = p.input_version + 1
  where p.circle_id = new.circle_id
    and p.state in ('seeking', 'collecting', 'ready');

  delete from public.plan_participants pp
  using public.plans p
  where pp.plan_id = p.id and pp.revision = p.revision and pp.user_id = new.user_id
    and p.circle_id = new.circle_id
    and p.state in ('seeking', 'collecting', 'ready');

  for affected in
    select p.id from public.plans p
    where p.circle_id = new.circle_id and p.state = 'ready'
  loop
    perform planning.transition_plan(affected, 'candidates_gone', new.user_id);
  end loop;

  -- Not coming to anything still ahead. History is left exactly as it was:
  -- `was_there` and `missed`, rows on closed confirmations, and rows on a
  -- meetup that has ended but not yet been reported on — `active` alone does
  -- not mean "ahead", and a `going` from last Thursday is part of the historic
  -- aggregate §4.5 lets remain.
  update public.attendance a
  set status = 'cant', updated_at = now()
  from public.meetup_confirmations c
  join public.plans p on p.id = c.plan_id
  where a.confirmation_id = c.id
    and a.user_id = new.user_id
    and p.circle_id = new.circle_id
    and c.status = 'active'
    and c.ends_at > now()
    and a.status in ('going', 'unknown');

  return new;
end;
$$;

revoke all on function public.on_member_removed() from public;
revoke all on function public.on_member_removed() from anon, authenticated;
