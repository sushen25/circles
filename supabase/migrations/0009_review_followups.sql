-- What the reviews of S1-10, S1-11 and S1-12b found, acted on after they
-- shipped (SUS-75). Three changes that are not function bodies, and then the
-- generated block carrying the one function body that changed.
--
-- Nothing above this file is edited. `0005` and `0006` are applied migrations;
-- a policy that was wrong is replaced here, where the replacement is recorded.

-- ---------------------------------------------------------------------------
-- 1. Attendance writes say "an active member", instead of meaning it by accident.
--
-- `attendance_insert_own` and `attendance_update_own` checked only that the row
-- was the caller's. `on_member_removed()` keeps `plan_participants` for plans
-- already `confirmed`, so a removed member is still a participant of one — and
-- what actually stopped them writing was not either policy. An
-- `update … where` is gated by `attendance_select_member` needing
-- `auth_is_member` to find the row at all; the *unqualified*
-- `update public.attendance set status = 'going'` is not, and reached the
-- trigger, where it failed only because `enforce_attendance_transition` is one
-- of the few trigger functions here without `security definer`, so its own read
-- of `meetup_confirmations` came back empty.
--
-- That is a guard by coincidence. Twenty-odd trigger functions in these
-- migrations *are* definer; adding it to that one for any ordinary reason would
-- have opened the path silently. So the rule goes where it belongs, in the same
-- shape `nudge_states_update_own` already uses.
-- ---------------------------------------------------------------------------

drop policy attendance_insert_own on public.attendance;
drop policy attendance_update_own on public.attendance;

create policy attendance_insert_own on public.attendance
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status <> 'unknown'
    and exists (
      select 1
      from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where c.id = confirmation_id and public.auth_is_member(p.circle_id)
    )
  );

create policy attendance_update_own on public.attendance
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where c.id = confirmation_id and public.auth_is_member(p.circle_id)
    )
  )
  with check (user_id = (select auth.uid()) and status <> 'unknown');

-- ---------------------------------------------------------------------------
-- 2. One address, two guest memberships.
--
-- Spec §9: "One verified address on multiple guest memberships in one plan: one
-- copy per event; memberships are not revealed to each other." `0006` made
-- `email_hash` unique across the table, so the second guest's insert failed —
-- and sharing the first contact was refused too, because a subscription's owner
-- must be its contact's owner. The spec named the case and the schema refused
-- it.
--
-- Uniqueness moves to the pair. Nothing else has to move with it: suppression
-- is already global by hash in `private.email_suppressions` and applied by a
-- `before insert` trigger, so a suppressed address stays suppressed for
-- everybody — which is the rule that made global uniqueness look necessary in
-- the first place. "One copy per event" is the dispatcher's, by `distinct
-- email_hash` at send time (S1-20).
-- ---------------------------------------------------------------------------

alter table private.email_contacts drop constraint email_contacts_email_hash_key;
alter table private.email_contacts add constraint email_contacts_address_per_identity
  unique (email_hash, user_id);

comment on constraint email_contacts_address_per_identity on private.email_contacts is
  'One address per identity, not one address per table: two guest memberships may each be reachable at the same address (spec §9). Suppression stays global, by hash, in email_suppressions.';

-- ---------------------------------------------------------------------------
-- 3. The function bodies that changed, from `supabase/sql/functions/`.
--
-- Only the ones that changed: `0008` carries the other forty-six, and a
-- one-function fix has no business restating them.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/report_outcome.sql
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
-- call with the same answer returns the report the first one wrote — the
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
  report public.outcome_reports;
begin
  if actor is null then
    raise exception 'report_outcome requires a signed-in actor' using errcode = 'insufficient_privilege';
  end if;

  select p.organiser_user_id into organiser
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

-- END GENERATED: function definitions
