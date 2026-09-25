-- ---------------------------------------------------------------------------
-- A cadence nudge, decided: the record that this circle's due date has been
-- prompted, and the jobs that carry it, in one transaction (S2-04).
--
-- **One per due date, whoever it goes to.** The idempotency key cannot say
-- that on its own: it is per recipient, so a second pass that chose somebody
-- else — the first person turned nudges off in between — would write a second
-- job with a second key, and two people would each be told it is their turn.
-- And the key does not last: `jobs.run_retention` deletes jobs after thirty
-- days, and a two-monthly circle stays due for longer than that. So the
-- decision is its own row, `private.cadence_prompts`, keyed on the circle and
-- the due date, and a job is written only by the pass that wrote that row.
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
-- Answers how many jobs were written, or null when this due date had already
-- been decided (or a plan is now open), so the caller records its analytics
-- event only for a decision that is new.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_prompt_cadence(
  p_circle_id uuid,
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
begin
  perform 1 from public.circles c where c.id = p_circle_id for update;
  if not found then
    return null;
  end if;

  if exists (
    select 1 from public.plans p
    where p.circle_id = p_circle_id and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
  ) then
    return null;
  end if;

  insert into private.cadence_prompts (circle_id, due_date, user_id, recipient_role)
  values (p_circle_id, p_due_date, p_user_id, p_recipient_role)
  on conflict (circle_id, due_date) do nothing;
  get diagnostics decided = row_count;
  if decided = 0 then
    return null;
  end if;

  -- Every job carries this circle and no plan: the check on the table says
  -- so, and a job for another circle is refused rather than quietly written.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j
    where (j ->> 'circle_id')::uuid is distinct from p_circle_id
       or j ->> 'kind' is distinct from 'about_time'
  ) then
    raise exception 'dispatch_prompt_cadence: jobs must be this circle''s about_time'
      using errcode = 'check_violation';
  end if;

  return public.dispatch_enqueue(p_jobs);
end;
$$;

comment on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb) is
  'Records that a circle''s due date has been prompted (to one person, or to nobody) and writes the about_time jobs that carry it, once per due date, under the circle lock; null when already decided or a plan is open. Service role only (S2-04).';

revoke all on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb) from public;
revoke all on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb)
  from anon, authenticated;
grant execute on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb)
  to service_role;
