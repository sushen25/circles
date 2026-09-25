-- ---------------------------------------------------------------------------
-- Whether "I was there" on this plan is the moment for "Start a circle for
-- another group" (spec §5.11, S2-07): the caller said they were there, and no
-- other meetup of this circle is known to have happened.
--
-- `record-nudge` asks this before it lets `after_attendance_start_circle` be
-- shown, and hands the answer to `nudgeEligibility` as `attendedFirstInCircle`.
-- The client cannot answer it: `report-outcome` says nothing about "first", and
-- a member cannot count the circle's attendance, because
-- `attendance_select_member` shows a retrospective answer to its subject alone.
--
-- **Known to have happened** is any of three things about another meetup of the
-- circle: the organiser reported it `happened`; the caller said `was_there` to
-- it; or the circle's `last_met_at` is before this one, which is how a history
-- older than the outcome report — a circle set up with "last caught up" — is
-- counted too. `last_met_at` never moves backwards and only `happened` moves
-- it, so a value at or after this meetup's start is this meetup's own.
--
-- **Security invoker, as the caller.** Every row it reads is one RLS already
-- shows a member — the plan, its confirmations, the outcome reports, the
-- caller's own attendance — so it needs no privilege of its own and cannot be
-- used to learn anything the caller could not read one table at a time. A plan
-- that is not in the caller's circles is no row at all, and `record-nudge`
-- reads that as not the moment.
-- ---------------------------------------------------------------------------

create or replace function public.after_attendance_facts(p_plan_id uuid)
returns table (attended boolean, first_in_circle boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.attendance a
      join public.meetup_confirmations c on c.id = a.confirmation_id
      where c.plan_id = p.id
        and a.user_id = (select auth.uid())
        and a.status = 'was_there'
    ) as attended,
    not exists (
      select 1
      from public.meetup_confirmations other
      join public.plans op on op.id = other.plan_id
      where op.circle_id = p.circle_id
        and other.plan_id <> p.id
        and (
          exists (
            select 1 from public.outcome_reports o
            where o.confirmation_id = other.id and o.outcome = 'happened'
          )
          or exists (
            select 1 from public.attendance a
            where a.confirmation_id = other.id
              and a.user_id = (select auth.uid())
              and a.status = 'was_there'
          )
        )
    )
    and (
      ci.last_met_at is null
      or ci.last_met_at >= coalesce(
        (select min(c.starts_at) from public.meetup_confirmations c where c.plan_id = p.id),
        ci.last_met_at
      )
    ) as first_in_circle
  from public.plans p
  join public.circles ci on ci.id = p.circle_id
  where p.id = p_plan_id;
$$;

comment on function public.after_attendance_facts(uuid) is
  'Whether the caller said "I was there" to this plan, and whether no other meetup of its circle is known to have happened — when "Start a circle" may follow (S2-07). Security invoker: reads only what RLS shows the caller.';

revoke all on function public.after_attendance_facts(uuid) from public;
revoke all on function public.after_attendance_facts(uuid) from anon;
grant execute on function public.after_attendance_facts(uuid) to authenticated;
