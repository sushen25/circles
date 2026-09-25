-- ---------------------------------------------------------------------------
-- 0028 — Guest → saved place: the prompts' record (SUS-55, S2-07).
--
-- S1-11 made `public.nudge_states` for a set of moments guessed before any
-- prompt was designed: the app nudges' four and `account_claimed`'s four, as
-- one union. The prompts built now need moments of their own, and the union
-- was the wrong shape for them — "save your place" after a reattach and the
-- app sheet after a second one were both `reattached`, so the once-per-moment
-- key could hold only one of them. The moments are now the domain's
-- (`NUDGE_MOMENTS` in `packages/domain/src/growth`), whose rules are over
-- them, and `150_analytics.sql` holds this constraint to that list.
--
-- **Every moment but the organiser gate names a plan** (`isPlanBoundMoment`).
-- The two reattach moments did not before; they do now because that is what
-- makes their history travel. `move_membership` moves a membership's
-- plan-bound rows to whichever identity reattaches, so the third browser
-- knows the second one was shown "save your place" — which is how the second
-- reattach becomes the app sheet's moment rather than the same prompt again.
--
-- **Rows written before this.** No client wrote `nudge_states` until now —
-- the record-nudge endpoint and its prompts are this ticket's — so the only
-- rows are the tests'. Anything outside the new vocabulary is deleted rather
-- than translated, because the old moments do not map onto the new ones.
--
-- **`claim_identity`** accepts the two new places a guest saves their place
-- from: `organiser_gate` and `reattached` (`CLAIM_MOMENTS` in
-- `packages/contracts/src/analytics.ts`).
--
-- **`answered_at`** is new, stamped by a trigger when the answer changes: the
-- back-off counts from it (`stamp_nudge_answer` says why not `updated_at`).
--
-- **`after_attendance_facts`** is new: whether "I was there" on a plan is the
-- circle's first known meetup, for `record-nudge` to hand the domain.
--
-- The caps themselves are not here. They are `nudgeEligibility`'s, run by
-- `record-nudge` over the caller's rows; the table's own rule is still only
-- the unique key, once per moment per plan, and RLS's own rows in own circles.
-- ---------------------------------------------------------------------------
begin;

alter table public.nudge_states
  drop constraint nudge_states_moment,
  drop constraint nudge_states_plan_shape;

delete from public.nudge_states
where moment not in (
  'after_attendance_start_circle', 'email_given_app', 'locked_in_app', 'organiser_gate',
  'reattached_save_place', 'reattached_twice_app', 'second_response_app', 'sent_save_access'
);

alter table public.nudge_states
  add constraint nudge_states_moment check (moment in (
    'after_attendance_start_circle', 'email_given_app', 'locked_in_app', 'organiser_gate',
    'reattached_save_place', 'reattached_twice_app', 'second_response_app', 'sent_save_access'
  )),
  -- A `case`, so a null does not pass (SUS-24).
  add constraint nudge_states_plan_shape check (
    case moment
      when 'organiser_gate' then plan_id is null
      else plan_id is not null
    end
  );

-- When the answer was given, stamped by `stamp_nudge_answer` below: the 30-day
-- back-off runs from it, and `updated_at` moves whenever a reattach rewrites
-- `user_id`. Not a column a client writes, so not in the grants.
alter table public.nudge_states add column answered_at timestamptz;
update public.nudge_states set answered_at = updated_at where answer is not null;

comment on column public.nudge_states.moment is
  'NUDGE_MOMENTS in packages/domain/src/growth. Every moment but organiser_gate names a plan.';

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/after_attendance_facts.sql
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
-- **Known to have happened** is either of two things about another meetup of
-- the circle: the organiser reported it `happened`, or the caller said
-- `was_there` to it. Not `circles.last_met_at`: `apply_outcome` is the only
-- thing that moves it, on a `happened` report — which is counted already — and
-- it keeps only the latest, so reading it made the answer depend on whether the
-- organiser had reported *this* meetup yet (review round 2). And this meetup
-- itself must not have been reported `cancelled`: "I was there" on an evening
-- the organiser says did not go ahead is not the moment either.
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
    )
    and not exists (
      select 1
      from public.outcome_reports o
      join public.meetup_confirmations c on c.id = o.confirmation_id
      where c.plan_id = p.id and o.outcome = 'cancelled'
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
    ) as first_in_circle
  from public.plans p
  where p.id = p_plan_id;
$$;

comment on function public.after_attendance_facts(uuid) is
  'Whether the caller said "I was there" to this plan, and whether no other meetup of its circle is known to have happened — when "Start a circle" may follow (S2-07). Security invoker: reads only what RLS shows the caller.';

revoke all on function public.after_attendance_facts(uuid) from public;
revoke all on function public.after_attendance_facts(uuid) from anon;
grant execute on function public.after_attendance_facts(uuid) to authenticated;

-- supabase/sql/functions/public/claim_identity.sql
-- ---------------------------------------------------------------------------
-- claim_identity
--
-- Somebody saves their place (§10): `linkIdentity` with an email code, or
-- `signInWithIdToken` with Apple or Google, on top of the anonymous session
-- they have been using as a guest. Two different things can have just happened,
-- and the client cannot tell them apart on its own:
--
--   * the identity was new, so Supabase attached it to the anonymous user —
--     same user id, `is_anonymous` now false, nothing to merge; or
--   * the identity already existed, so Supabase signed them in *as that user*
--     and the anonymous one is now abandoned along with its memberships.
--
-- The second is the case §10 means by "`claim-identity` to reconcile
-- memberships if the permanent identity already existed".
--
-- **Granted to `service_role` and nothing else.** This is the one function of
-- the three whose authorisation cannot live in SQL: the claim being made is "I
-- was also this anonymous user", and the only proof of it is that session's
-- access token, which the caller no longer holds as `auth.uid()`. The Edge
-- Function verifies that token and then calls this. Were it callable by
-- `authenticated`, `p_anonymous_user_id` would be an unchecked parameter naming
-- somebody else's guest membership — which is to say, a way to take it. A
-- definer function granted to a client role must never take the identity it
-- acts on as an argument; this one takes two, so it is not granted to one.
--
-- Idempotent. Saying it twice moves nothing the first call did not move, and
-- the audit row keeps `growth.account_claimed` from being counted twice.
-- ---------------------------------------------------------------------------

create or replace function public.claim_identity(
  p_user_id uuid,
  p_anonymous_user_id uuid,
  p_moment text
)
returns table (merged_memberships integer, duplicates_removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  merged integer := 0;
  -- Counted separately because the client has an analytics event for it —
  -- `duplicate_member_removed` in `packages/contracts/analytics.ts` — and nothing
  -- could produce it: the row's removal emits the ordinary
  -- `circles.member_removed`, which says nothing about *why*. Only this function
  -- knows, so only this function can report it.
  removed integer := 0;
  membership record;
begin
  if p_user_id is null or p_anonymous_user_id is null then
    raise exception 'claim_identity needs both identities'
      using errcode = 'null_value_not_allowed';
  end if;

  -- The moment is an enum in `packages/contracts/analytics.ts`, and the event
  -- this writes is validated against that catalogue downstream. Refusing here
  -- turns a payload the pipeline would drop into an error the caller can see.
  if p_moment is null or p_moment not in
    ('after_answer', 'after_attendance', 'after_confirmed', 'organiser_gate', 'reattached',
     'settings') then
    raise exception 'claim_identity got an unknown moment'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A saved place is what is being claimed, so the destination must have one.
  -- Without this check an anonymous caller could have its own profile marked
  -- permanent — which takes it off every Continue-as list and makes its
  -- membership unreattachable, locking somebody out of their own way back in
  -- without a sign-in anywhere in the story. Read from `auth.users`, which only
  -- the auth server writes.
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and not coalesce(u.is_anonymous, true)
  ) then
    raise exception 'destination_is_not_permanent' using errcode = 'insufficient_privilege';
  end if;

  -- The durable record of the saved place. `handle_user_updated` sets this when
  -- the auth row stops being anonymous, which covers the `linkIdentity` case;
  -- this covers the other one, where the permanent user existed already and its
  -- profile may predate the column.
  update public.profiles p set is_permanent = true
  where p.user_id = p_user_id and not p.is_permanent;

  if p_anonymous_user_id <> p_user_id then
    -- Never merge *from* a saved place. Both identities belonging to one person
    -- is the premise; two saved places is two accounts, and moving memberships
    -- between them on a client's word would be a way to take one. The anonymous
    -- side has nothing to lose and no sign-in to bypass, which is exactly why it
    -- is the only side this accepts.
    if exists (
      select 1 from auth.users u
      where u.id = p_anonymous_user_id and not coalesce(u.is_anonymous, false)
    ) or exists (
      select 1 from public.profiles p
      where p.user_id = p_anonymous_user_id and p.is_permanent
    ) then
      raise exception 'source_is_permanent' using errcode = 'insufficient_privilege';
    end if;

    for membership in
      select m.circle_id
      from public.circle_members m
      where m.user_id = p_anonymous_user_id and m.status = 'active'
      -- Locked in a fixed order: two claims racing for one pair of identities
      -- would otherwise deadlock against each other half way through.
      order by m.circle_id
      for update
    loop
      if exists (
        select 1 from public.circle_members m
        where m.circle_id = membership.circle_id and m.user_id = p_user_id
          and m.status = 'active'
      ) then
        -- Both identities are *active* in this circle: one person who joined
        -- twice, from two devices, under two names (spec §9). The saved place is
        -- the one that keeps working, so it stays and the guest row goes.
        --
        -- Everything the survivor does not already have is adopted first.
        -- `on_member_removed` deletes or neutralises what is left on the removed
        -- membership (spec §4.5), and an answer this person gave is not a thing to
        -- delete because they signed in. `private.adopt_membership_rows` holds the
        -- list, so it is one list with `move_membership` rather than a handful of
        -- updates written out here and forgotten about separately.
        perform private.adopt_membership_rows(
          membership.circle_id, p_anonymous_user_id, p_user_id
        );

        update public.circle_members m
        set status = 'removed'
        where m.circle_id = membership.circle_id and m.user_id = p_anonymous_user_id;
        removed := removed + 1;

        -- The retired identity stays, and so does this `removed` row. That is not
        -- the reattachment story — there the membership *leaves* the old identity,
        -- which then has none and is swept by `run_retention` after thirty days
        -- (ADR 0014: "a guest session that never joined anything"). This identity
        -- joined something, so it is not abandoned by that definition and the sweep
        -- will not take it.
        --
        -- Which is right, and is what happens to any guest an owner removes: the row
        -- carries the `display_name_snapshot` the roster shows for somebody who is
        -- no longer here (spec §5.2), and deleting the identity would delete the
        -- name with it. Widening the sweep to `status = 'active'` would be a change
        -- to a retention rule, which is §8.5's and wants an ADR, not a line here.
      else
        -- `status = 'active'` above, and not merely "has a row", because the
        -- account may hold a membership of this circle that *ended*. Treating
        -- that as a collision removed the guest's live membership and
        -- `on_member_removed` deleted the availability they had just submitted —
        -- so saving your place cost you the circle, which is the opposite of
        -- "linking the existing guest membership. Nothing already sent changes"
        -- (spec §5.1).
        --
        -- The old row is the same person's, under the name they had then, and its
        -- answers are long gone. It is deleted to make room rather than revived:
        -- the membership that matters is the live one, and a primary key of
        -- `(circle_id, user_id)` has room for exactly one.
        -- The residue first. A real removal is an UPDATE, so `on_member_removed`
        -- ran — and it leaves being required, the participant row on a confirmed
        -- plan, the prompts already shown, an interest answer, and an attendance
        -- it rewrote to `cant`. Every one of those collides with the guest's row
        -- for the same plan, and deleting only the membership row let the claim
        -- abort on a primary key instead.
        perform private.discard_membership_rows(
          membership.circle_id, p_user_id, p_anonymous_user_id
        );

        delete from public.circle_members m
        where m.circle_id = membership.circle_id and m.user_id = p_user_id
          and m.status = 'removed';

        -- The name the circle knows them by travels with the membership rather
        -- than being replaced by the profile's. Nobody's roster entry should
        -- change because somebody else signed in.
        perform private.move_membership(membership.circle_id, p_anonymous_user_id, p_user_id);
        merged := merged + 1;
      end if;
    end loop;
  end if;

  -- Once per account, whatever the client retries. The audit log is the record
  -- rather than the outbox, because the outbox is drained and swept and this has
  -- to stay true for longer than that.
  if not exists (
    select 1 from private.audit_log a
    where a.action = 'growth.account_claimed' and a.resource_id = p_user_id
  ) then
    insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
    values (p_user_id, 'growth.account_claimed', 'account', p_user_id,
            jsonb_build_object('moment', p_moment, 'merged_memberships', merged));

    perform jobs.emit('growth.account_claimed', 'account', p_user_id,
      jsonb_build_object('user_id', p_user_id, 'moment', p_moment));
  end if;

  return query select merged, removed;
end;
$$;

comment on function public.claim_identity(uuid, uuid, text) is
  'Reconciles an anonymous identity''s memberships onto a permanent one after sign-in (§10), returning how many moved and how many duplicates were removed. Service role only: the anonymous identity is a parameter, and its proof is a token only the Edge Function can check.';

revoke all on function public.claim_identity(uuid, uuid, text) from public;
revoke all on function public.claim_identity(uuid, uuid, text) from anon, authenticated;
grant execute on function public.claim_identity(uuid, uuid, text) to service_role;

-- supabase/sql/functions/public/stamp_nudge_answer.sql
-- ---------------------------------------------------------------------------
-- When a prompt was answered (S2-07).
--
-- The 30-day back-off runs from the second "not now" (`appBackOffUntil` in
-- `packages/domain/src/growth`), so the time an answer was given is a fact the
-- rules read. `updated_at` is not it: `move_membership` rewrites `user_id` on a
-- reattach, which would restart a back-off every time somebody came back on a
-- new browser. So the answer stamps its own column, here rather than in the
-- client, because the client writes this table directly (§8.4) and a stamp it
-- could leave out is not one the rule can lean on.
-- ---------------------------------------------------------------------------

create or replace function public.stamp_nudge_answer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.answered_at := case when new.answer is null then null else now() end;
  elsif new.answer is distinct from old.answer then
    new.answered_at := case when new.answer is null then null else now() end;
  else
    new.answered_at := old.answered_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_nudge_answer() from public;
revoke all on function public.stamp_nudge_answer() from anon, authenticated;

-- END GENERATED: function definitions

create trigger nudge_states_stamp_answer
  before insert or update on public.nudge_states
  for each row execute function public.stamp_nudge_answer();

commit;
