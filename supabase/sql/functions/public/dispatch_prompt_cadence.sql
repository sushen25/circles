-- ---------------------------------------------------------------------------
-- A cadence nudge, decided: the record that this circle's due date has been
-- prompted, and the jobs that carry it, in one transaction (S2-04).
--
-- **One per cycle, whoever it goes to.** The idempotency key cannot say
-- that on its own: it is per recipient, so a second pass that chose somebody
-- else — the first person turned nudges off in between — would write a second
-- job with a second key, and two people would each be told it is their turn.
-- And the key does not last: `jobs.run_retention` deletes jobs after thirty
-- days, and a two-monthly circle stays due for longer than that. So the
-- decision is its own row, `private.cadence_prompts`, keyed on the circle and
-- the meetup the cycle counts from (`p_last_met_at`), and a job is written
-- only by the pass that wrote that row. A cycle has one due date; an owner who
-- changes the cadence after the nudge went moves the date, not the decision,
-- so nobody is asked twice about one meetup (review round 2).
--
-- **The cycle the caller read is the cycle it writes.** `p_last_met_at` is
-- the `last_met_at` the due date was worked out from, and it is compared under
-- the lock: a meetup reported in between has started a new cycle, whose due
-- date this call does not know, and nothing is written.
--
-- **Nobody is a decision too.** `p_user_id` is null when the rule found
-- nobody to ask — everyone said no, or the one person the policy names did —
-- and the row is written anyway, so the sweep does not ask the same question
-- every minute until somebody changes a switch (ADR 00XX).
--
-- **A plan made meanwhile wins.** The circle row is locked first — the lock
-- `planning.transition_plan` takes before it lets a plan open (ADR 0033) — and
-- the open-plan test is asked again under it. A plan that opened between the
-- sweep's read and this call is seen here and nothing is written; one that
-- opens after waits for this commit, and the sender asks again at send time.
--
-- Answers how many jobs were written, or null when this cycle had already
-- been decided (or a plan is now open, or the circle has met since), so the caller records its analytics
-- event only for a decision that is new.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_prompt_cadence(
  p_circle_id uuid,
  p_last_met_at timestamptz,
  p_due_date date,
  p_user_id uuid,
  p_recipient_role text,
  p_jobs jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  decided integer;
  met timestamptz;
begin
  -- Every job carries this circle and no plan: the check on the table says
  -- so, and a job for another circle is refused rather than quietly written —
  -- asked first, so that a caller's mistake is an error whatever else holds.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j
    where (j ->> 'circle_id')::uuid is distinct from p_circle_id
       or j ->> 'kind' is distinct from 'about_time'
  ) then
    raise exception 'dispatch_prompt_cadence: jobs must be this circle''s about_time'
      using errcode = 'check_violation';
  end if;

  select c.last_met_at into met from public.circles c where c.id = p_circle_id for update;
  if not found or met is distinct from p_last_met_at then
    return null;
  end if;

  if exists (
    select 1 from public.plans p
    where p.circle_id = p_circle_id and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
  ) then
    return null;
  end if;

  insert into private.cadence_prompts (circle_id, last_met_at, due_date, user_id, recipient_role)
  values (p_circle_id, p_last_met_at, p_due_date, p_user_id, p_recipient_role)
  on conflict (circle_id, last_met_at) do nothing;
  get diagnostics decided = row_count;
  if decided = 0 then
    return null;
  end if;

  return public.dispatch_enqueue(p_jobs);
end;
$$;

comment on function public.dispatch_prompt_cadence(uuid, timestamptz, date, uuid, text, jsonb) is
  'Records that a circle''s due date has been prompted (to one person, or to nobody) and writes the about_time jobs that carry it, once per cycle (the last_met_at it counts from), under the circle lock; null when already decided, a plan is open or the circle has met since. Service role only (S2-04).';

revoke all on function public.dispatch_prompt_cadence(uuid, timestamptz, date, uuid, text, jsonb) from public;
revoke all on function public.dispatch_prompt_cadence(uuid, timestamptz, date, uuid, text, jsonb)
  from anon, authenticated;
grant execute on function public.dispatch_prompt_cadence(uuid, timestamptz, date, uuid, text, jsonb)
  to service_role;
