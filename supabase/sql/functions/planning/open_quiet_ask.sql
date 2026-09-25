-- ---------------------------------------------------------------------------
-- A quiet ask's one crossing, attempted (spec §5.4.5, ADR 0035).
--
-- `nextQuietStep` and `recordInterest` in `packages/domain/src/planning`, in
-- the transaction that holds the plan's row: `true` if the ask opened, `false`
-- if it is below its threshold, past its stop time, or **held** — at its
-- threshold while another plan of the circle is `collecting` or `ready`
-- (ADR 0033). A held ask stays `seeking`, shows nothing, and is tried again on
-- the next answer (`record_interest`, a repeat included) and on every
-- dispatcher sweep (`dispatch_open_quiet_ask`), until it opens or its stop
-- time closes it.
--
-- **The caller holds the lock.** `transition_plan` takes `for update` on the
-- plan as well, and a re-lock in the same transaction is free; what matters is
-- that the count below is read after the lock was taken, so two answers
-- arriving together are counted one after the other and exactly one of them
-- crosses (SUS-24's note). The machine's own `threshold` guard counts the same
-- rows again, and is the authority; the count here only decides whether to ask
-- it, so that "below" never costs an exception.
--
-- `plan_in_progress` from the `no_open_plan` guard is "not yet", not a
-- failure (SUS-89): caught in its own block, so the answer that was recorded
-- stays recorded. Anything else is raised.
--
-- The deadline is the domain's (`defaultDeadline(preset, now, lastPossibleStart)`),
-- worked out by the caller before the lock and passed in: a second copy of the
-- rule in SQL would be one that drifts. `enforce_plan_deadline` still refuses
-- one after the last possible start.
-- ---------------------------------------------------------------------------

create or replace function planning.open_quiet_ask(p_plan_id uuid, p_deadline timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  keen integer;
begin
  select * into plan from public.plans p where p.id = p_plan_id for update;
  if not found or plan.mode <> 'quiet' or plan.state <> 'seeking' then
    return false;
  end if;
  -- From its stop time an ask only expires (`nextQuietStep`), even before the
  -- sweep has written `expired`.
  if plan.quiet_expires_at is null or now() >= plan.quiet_expires_at or p_deadline is null then
    return false;
  end if;

  select count(*) into keen
  from private.plan_interest i
  where i.plan_id = plan.id and i.response = 'keen';
  if keen < plan.quiet_threshold then
    return false;
  end if;

  begin
    perform planning.transition_plan(
      plan.id, 'threshold_reached', null,
      jsonb_build_object('response_deadline', p_deadline)
    );
  exception when raise_exception then
    if sqlerrm = 'plan_in_progress' then
      return false;
    end if;
    raise;
  end;
  return true;
end;
$$;

comment on function planning.open_quiet_ask(uuid, timestamptz) is
  'Opens a seeking quiet ask that has met its threshold, with the given response deadline, unless it is past its stop time or held beside an open plan (ADR 0033, ADR 0035). True if it opened.';

revoke all on function planning.open_quiet_ask(uuid, timestamptz) from public;
revoke all on function planning.open_quiet_ask(uuid, timestamptz) from anon, authenticated;
