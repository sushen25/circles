-- ---------------------------------------------------------------------------
-- A member's private answer to a quiet ask, and the threshold evaluated in the
-- same transaction (spec §5.4, architecture §9.1 `answer-interest`).
--
-- `recordInterest` in `packages/domain/src/planning/quiet.ts`, under the
-- plan's row lock, which is what makes "exactly once" true: fifty answers
-- arriving together queue on the lock, each counts what the one before it
-- wrote, and the first to find the threshold met is the one that crosses. The
-- rest find the plan `collecting` and are told interest has closed.
--
-- **The answer is the only thing that goes back, and it has no count in it.**
-- `threshold_reached` is false for "one more needed", "ten more needed" and
-- "held beside an open plan" alike (`InterestReceipt`), so two answers read
-- side by side cannot be differenced to find the person between them.
--
-- The refusals, in order:
--
--   * `plan_not_found` — no such plan, or not one of the caller's circles. One
--     answer for both, so a plan id is not a way to learn a circle exists.
--   * `not_quiet` — a named plan has no interest to record.
--   * `interest_closed` — the ask is not `seeking`, or has reached its stop
--     time. At or after `quiet_expires_at` it is closed even before the sweep
--     writes `expired` (SUS-49 note 5), and once it has opened it is closed for
--     good, which is what keeps the post-threshold count a constant.
--   * `initiator_is_keen` — the initiator counts as keen from creation and
--     stays so; to stop, they withdraw (`cancel-plan`).
--
-- A repeat is not an error and changes nothing but the attempt: the ask is
-- re-evaluated on every answer, because a held ask opens on the first answer
-- after the circle's open plan finishes (ADR 0035).
--
-- **Service role only**, with the actor passed in by `answer-interest` from
-- the verified JWT. The deadline an opening ask gets is the domain's, and a
-- function a client could call directly would be a function a client could
-- hand any deadline it liked.
--
-- Emits nothing of its own. The architecture's catalogue names
-- `planning.interest_recorded`, and it is deliberately not raised: an event
-- per answer is a clock on who answered when, which is a way of telling who
-- was keen by who was online. The crossing's own event is `transition_plan`'s.
-- ---------------------------------------------------------------------------

create or replace function public.record_interest(
  p_plan_id uuid,
  p_actor uuid,
  p_interested boolean,
  p_deadline_if_opened timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  answer text := case when p_interested then 'keen' else 'not_this_time' end;
begin
  if p_actor is null or p_interested is null then
    raise exception 'record_interest needs an actor and an answer'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The circle first, then the plan: the order `on_member_removed` takes them
  -- in, so an answer and a removal in one circle queue rather than deadlock
  -- (review round 4). The crossing's `no_open_plan` guard locks the circle
  -- again, which is free by then.
  perform 1 from public.circles c
  where c.id = (select p.circle_id from public.plans p where p.id = p_plan_id)
  for update;
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or not exists (
    select 1 from public.circle_members m
    where m.circle_id = plan.circle_id and m.user_id = p_actor and m.status = 'active'
  ) then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  if plan.mode <> 'quiet' then
    raise exception 'not_quiet' using errcode = 'P0001';
  end if;

  if (case
    when plan.state = 'seeking' then plan.quiet_expires_at is null or now() >= plan.quiet_expires_at
    else true
  end) then
    raise exception 'interest_closed' using errcode = 'P0001';
  end if;

  if answer <> 'keen' and exists (
    select 1 from private.plan_initiators pi
    where pi.plan_id = plan.id and pi.initiator_user_id = p_actor
  ) then
    raise exception 'initiator_is_keen' using errcode = 'P0001';
  end if;

  insert into private.plan_interest as i (plan_id, user_id, response)
  values (plan.id, p_actor, answer)
  on conflict (plan_id, user_id) do update
    set response = excluded.response,
        responded_at = case
          when i.response is distinct from excluded.response then now()
          else i.responded_at
        end;

  return jsonb_build_object(
    'threshold_reached', planning.open_quiet_ask(plan.id, p_deadline_if_opened)
  );
end;
$$;

comment on function public.record_interest(uuid, uuid, boolean, timestamptz) is
  'Records one member''s private answer to a seeking quiet ask and, in the same transaction, opens the ask if its threshold is met and the circle has no open plan. Returns only whether it opened. Service role only (S2-02).';

revoke all on function public.record_interest(uuid, uuid, boolean, timestamptz) from public;
revoke all on function public.record_interest(uuid, uuid, boolean, timestamptz) from anon, authenticated;
grant execute on function public.record_interest(uuid, uuid, boolean, timestamptz) to service_role;
