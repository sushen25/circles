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
-- The circle row and then the plan rows are locked first, so a removal racing a
-- first answer cannot let the answer land behind it — and nor can a removal
-- racing a *new plan*. Locking the plans alone was not enough for that one:
-- `create_plan` reads the circle's active members and inserts its participant
-- rows in a transaction this trigger cannot see, so a removal committing in the
-- middle of it locked nothing the creation held, deleted nothing that existed
-- yet, and left the departed member on the roster of a plan created after they
-- had gone. `create_plan` takes the circle row for update for its own reasons;
-- taking the same one here is what makes the two wait for each other.
--
-- Circle before plans, which is the order `create_plan` locks in too. Two
-- transactions taking the same locks in the same order cannot deadlock over
-- them.
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

  perform 1 from public.circles c where c.id = new.circle_id for update;
  perform 1 from public.plans p where p.circle_id = new.circle_id for update;

  delete from public.plan_responses r
  using public.plans p
  where r.plan_id = p.id
    and p.circle_id = new.circle_id and r.user_id = new.user_id;

  update public.plans p
  set input_version = p.input_version + 1
  where p.circle_id = new.circle_id
    and p.state in ('seeking', 'collecting', 'ready');

  -- Their answer to a quiet ask still asking goes with them (architecture
  -- §9.1: removal deletes answers to plans still asking). Left, a departed
  -- member's `keen` went on counting toward the threshold, and could open an
  -- ask the circle as it now is had not reached (SUS-50 review round 1). An
  -- ask that has opened keeps its rows: interest closed when it opened, and
  -- the count shown from then on is the one it opened with.
  delete from private.plan_interest i
  using public.plans p
  where i.plan_id = p.id and i.user_id = new.user_id
    and p.circle_id = new.circle_id and p.state = 'seeking';

  -- An organiser removed from a quiet plan that has opened and not been
  -- locked in leaves the role free, so somebody keen can take it again
  -- (`accept_organiser`). Left, the plan named a person who could no longer
  -- see it and refused every active member `already_taken` — stranded (SUS-50
  -- review round 2). Only the quiet plan: its role is one somebody *accepts*,
  -- and accepting is the way back. A named plan's organiser is the person who
  -- made it; handing that on is SUS-53's.
  update public.plans p
  set organiser_user_id = null
  where p.circle_id = new.circle_id and p.organiser_user_id = new.user_id
    and p.mode = 'quiet' and p.state in ('collecting', 'ready');

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
