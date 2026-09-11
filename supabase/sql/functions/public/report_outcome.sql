-- The one way a client reports an outcome (architecture §8.4: attendance is
-- the only confirmation table a member writes directly). The actor is
-- `auth.uid()`, never a parameter, and `reported_at` is the server's clock.
-- The organiser check here is the cheap, early one; the one that counts —
-- organiser *and still a member* — is `transition_plan`'s, reached through the
-- trigger, and it is not duplicated.
--
-- **It is idempotent**, because AGENTS.md says transitions are and because this
-- one is tapped on a phone the morning after a catch-up: a retry whose first
-- attempt committed but whose answer was lost must not report failure for
-- something that worked, or the organiser will sensibly try again. So a second
-- call with the same answer — the same payload, field for field, a null `note`
-- included — returns the report the first one wrote; the
-- insert does not happen, so `apply_outcome` does not fire, so nothing is
-- recorded or announced twice. A second call with a *different* answer is not
-- a retry but a change of mind, and there is no way to take an outcome back:
-- it is refused, and says so.

create or replace function public.report_outcome(
  p_confirmation_id uuid,
  p_outcome text,
  p_note text default null,
  p_moved_outside boolean default null
)
returns public.outcome_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  organiser uuid;
  circle uuid;
  report public.outcome_reports;
begin
  if actor is null then
    raise exception 'report_outcome requires a signed-in actor' using errcode = 'insufficient_privilege';
  end if;

  select p.organiser_user_id, p.circle_id into organiser, circle
  from public.meetup_confirmations c
  join public.plans p on p.id = c.plan_id
  where c.id = p_confirmation_id;

  if organiser is distinct from actor then
    raise exception 'only the organiser reports an outcome' using errcode = 'insufficient_privilege';
  end if;

  insert into public.outcome_reports (confirmation_id, reported_by, outcome, note, moved_outside)
  values (p_confirmation_id, actor, p_outcome, p_note, p_moved_outside)
  on conflict (confirmation_id, reported_by) do nothing
  returning * into report;

  if report.id is not null then
    return report;
  end if;

  -- The conflict: this organiser has already answered for this confirmation.
  --
  -- This is the one branch that *returns* a row rather than writing one, so it
  -- is the one branch that has to ask about membership. A first call never gets
  -- this far without `transition_plan` agreeing the actor is a member, but a
  -- replay skips it — and `outcome_reports_select_member` would not show this
  -- row to somebody who has left the circle, so neither will this.
  if not public.auth_is_member(circle) then
    raise exception 'not_a_member_of_this_circle' using errcode = 'insufficient_privilege';
  end if;

  select * into report from public.outcome_reports r
  where r.confirmation_id = p_confirmation_id and r.reported_by = actor;

  if report.outcome is distinct from p_outcome
     or report.note is distinct from p_note
     or report.moved_outside is distinct from p_moved_outside then
    raise exception 'outcome_already_reported' using errcode = 'check_violation';
  end if;

  return report;
end;
$$;

comment on function public.report_outcome(uuid, text, text, boolean) is
  'The organiser''s answer to "did this catch-up happen?". The only client write path to outcome_reports; the insert trigger does the rest.';

grant execute on function public.report_outcome(uuid, text, text, boolean) to authenticated;
revoke all on function public.report_outcome(uuid, text, text, boolean) from public;
revoke all on function public.report_outcome(uuid, text, text, boolean) from anon;
