-- 0050_quiet_answer_stays_with_the_member
--
-- A quiet-ask answer stays with the member who gave it (SUS-182, ADR 0062).
-- A Continue-as pick used to move the previous holder's interest answer to
-- whoever tapped the name, and `quiet_viewer_facts` showed it to them as their
-- own. `move_membership` now moves that answer only when the move proves the
-- person (an emailed link, or a save of one's own place); `reattach_member`
-- turns it off for a list pick. Function definitions only; existing rows are
-- untouched.

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/private/move_membership.sql
-- ---------------------------------------------------------------------------
-- One membership, one circle, from one identity to another.
--
-- Both paths that move a membership use this: `reattach_member`, when a guest
-- comes back with no session (ADR 0006), and `claim_identity`, when somebody
-- saves their place and turns out to have had a permanent identity already.
-- One copy, because the cost of two is a table moved by one of them and left
-- behind by the other — and "left behind" means a guest who reattaches and
-- finds their answers gone.
--
-- It decides nothing. Who may move what is the caller's question: this assumes
-- it has already been answered and does the writing. The one thing the caller
-- can say is whether the person's own interest answer travels with the place
-- (`circles.carry_interest`, transaction-local): it does for every move that
-- proves the person, and does not for a pick from the Continue-as list.
--
-- `member_dayparts` and any re-entry token for the membership are absent below
-- because they move themselves — both reference `circle_members` with
-- `on update cascade`, which 0006 and 0007 put there for this moment.
--
-- `analytics.events` **is** here, and it took a review round to see why. It has
-- no foreign key to `auth.users` — an event outlives the row it was about — so
-- it is invisible to the guard in `095_identity_merge.sql` that catches a table
-- this function forgot. The argument for leaving it alone was that an event
-- records what happened to an identity at a time; the argument that wins is
-- that `plan_timings` joins a member's link-open to their answer on `user_id`,
-- and leaving the event behind broke that join for everybody who came back on a
-- new device — measuring §11.4's gate over exactly the people who did not.
-- ---------------------------------------------------------------------------

create or replace function private.move_membership(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The inputs are not changing, only whose they are — see `bump_input_version`.
  -- Local to the transaction, so it cannot leak into anything else.
  perform set_config('circles.moving_membership', 'on', true);

  -- Outstanding emailed links first, while `membership_user_id` still names the
  -- identity they were issued against: the write below cascades that column, and
  -- `enforce_reentry_for_guests` fires on it. `private.retire_reentry_links` says
  -- what happens and why, and `reconcile_contacts` calls it too — the
  -- duplicate-merge path reaches the same tokens by a different route.
  perform private.retire_reentry_links(p_circle_id, p_from, p_to);

  -- The membership itself, first: the cascading references follow this write.
  update public.circle_members m
  set user_id = p_to
  where m.circle_id = p_circle_id and m.user_id = p_from;

  -- Everything else the member owns. Each of these references `auth.users`
  -- with no action on update, so each is moved by name — and
  -- `090_identity_continuity.sql` checks the list against the catalogue rather
  -- than trusting that it is complete.
  update public.plan_responses r set user_id = p_to
  where r.user_id = p_from
    and r.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_participants pp set user_id = p_to
  where pp.user_id = p_from
    and pp.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_required_members rm set user_id = p_to
  where rm.user_id = p_from
    and rm.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.attendance a set user_id = p_to
  where a.user_id = p_from
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where p.circle_id = p_circle_id
    );

  update public.nudge_states n set user_id = p_to
  where n.user_id = p_from
    and n.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The person's own quiet-ask answer moves only when the caller says the move
  -- is the same person's (`circles.carry_interest`, on unless a caller turns it
  -- off). A pick from the Continue-as list proves nothing about who tapped it,
  -- and an answer that moved to the taker reached their screen as "your answer"
  -- (`quiet_viewer_facts`), which is an individual interest answer read by
  -- somebody else (SUS-182, ADR 0062). So on that path the taker starts with no
  -- answer. While the ask is still `seeking` the row is deleted, as removal
  -- does (`on_member_removed`), so the real member can answer again without
  -- being counted twice. Once the ask has opened, interest is closed and the
  -- count shown is the one it opened with, so the row stays where it was: under
  -- an identity that is no longer a member, still counted, readable by nobody.
  if coalesce(nullif(current_setting('circles.carry_interest', true), ''), 'on') = 'on' then
    update private.plan_interest i set user_id = p_to
    where i.user_id = p_from
      and i.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);
  else
    delete from private.plan_interest i
    using public.plans p
    where i.plan_id = p.id and i.user_id = p_from
      and p.circle_id = p_circle_id and p.state = 'seeking';
  end if;

  -- The measurements follow the person too, which is easy to miss because this
  -- is the one table here with no foreign key to `auth.users` — an event
  -- outlives the row it was about, so it deliberately holds ids rather than
  -- references. `plan_timings` matches a member's link-open event to their
  -- answer on `user_id`, and leaving the event behind broke that join the
  -- moment somebody reattached: their open-to-response wait vanished from
  -- §11.4's gate, and yesterday's figure changed today. The gate would have
  -- been measured over exactly the members who never came back on a new device.
  update analytics.events e set user_id = p_to
  where e.user_id = p_from
    and (
      e.circle_id = p_circle_id
      or e.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id)
    );

  -- The availability snapshots name who could come, and `transition_plan` reads
  -- the candidate's array at confirm time to decide who is `going`. A stale id
  -- there is this person marked `unknown` at the one moment the product is
  -- about.
  update public.candidates c
  set available_user_ids = array_replace(c.available_user_ids, p_from, p_to)
  where p_from = any (c.available_user_ids)
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  -- And the one id a near-miss carries. `{"kind":"required_missing","userId":…}`
  -- is the single rule the no-quorum screen shows — "the closest near-misses,
  -- the blocking rule, and three actions" (spec §5.6) — and it names somebody
  -- who is *not* available, so the array above never touches it. Left behind, it
  -- would name an identity that has just stopped being a member, and the screen
  -- would blame a person who is not there for a plan the person who *is* there
  -- is blocking.
  update public.candidates c
  set near_miss_reason = jsonb_set(c.near_miss_reason, '{userId}', to_jsonb(p_to::text))
  where c.near_miss_reason ->> 'kind' = 'required_missing'
    and c.near_miss_reason ->> 'userId' = p_from::text
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  update public.meetup_confirmations mc
  set available_user_ids = array_replace(mc.available_user_ids, p_from, p_to)
  where p_from = any (mc.available_user_ids)
    and mc.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The address this membership is reachable at, and everything hanging off it.
  -- In `private.reconcile_contacts`, shared with `adopt_membership_rows`, because
  -- the duplicate-merge path needs exactly the same work and having it here only
  -- left that path stranding a retired membership's consent and links.
  perform private.reconcile_contacts(p_circle_id, p_from, p_to);

  -- Queued mail for the person, not yet sent. A job left on the old identity is
  -- a message the dispatcher either sends to nobody or drops when retention
  -- takes the abandoned identity with it.
  update jobs.notification_jobs j set user_id = p_to
  where j.user_id = p_from
    and j.sent_at is null
    and j.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);
  perform set_config('circles.moving_membership', 'off', true);
end;
$$;

comment on function private.move_membership(uuid, uuid, uuid) is
  'Moves one circle membership and every row scoped to it from one identity to another. Shared by reattach_member and claim_identity; decides nothing.';

revoke all on function private.move_membership(uuid, uuid, uuid) from public;
revoke all on function private.move_membership(uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/public/reattach_member.sql
-- ---------------------------------------------------------------------------
-- reattach_member
--
-- A guest comes back with no session — the expected path, not the rare one
-- (ADR 0006: Safari drops script-writable storage after seven idle days, and
-- chat in-app browsers isolate it). They sign in anonymously again, pick their
-- name from the Continue-as list or arrive on an emailed `/a/<token>` link, and
-- this moves the membership and everything scoped to it onto the new identity.
--
-- Two ways in, one path through. The list names the membership; the token
-- authorises it. Everything after resolution is identical, which is the point
-- ADR 0006 and §10 both make: "this reuses one reattachment path for both the
-- manual and the emailed case".
--
-- The safeguards are all here rather than in the Edge Function, because they
-- are the decision and not the throttle: the caller must be a guest, the target
-- must be a guest (the one exception, an emailed link taking a place back from a
-- saved account, is ADR 0049 decision 6), and a membership may be moved by the
-- list at most three times in seven days. Enforced where it cannot be skipped.
--
-- **The old identity is not deleted here.** It can hold memberships in other
-- circles; `circles.owner_user_id`, `circle_invites.created_by` and
-- `plans.organiser_user_id` reference `auth.users` with no action, so a delete can
-- *fail* at the worst moment; and `run_retention` already deletes anonymous
-- identities with no memberships after thirty days (ADR 0014, §8.5).
-- ---------------------------------------------------------------------------

create or replace function public.reattach_member(
  p_circle_id uuid default null,
  p_target_user_id uuid default null,
  p_reentry_token_hash bytea default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_circle uuid := p_circle_id;
  target uuid := p_target_user_id;
  token private.email_action_tokens;
  chosen public.circles;
  -- `member_reattached`'s analytics payload is `source: 'list' | 'email'`
  -- (packages/contracts/src/analytics.ts), and the reattach rate by source is
  -- what tells us whether the emailed path is worth its machinery. The function
  -- is the only place that knows which one happened.
  entry_source text := case when p_reentry_token_hash is null then 'list' else 'email' end;
  -- The place is held by a saved account and the link may take it back (ADR 0049, 6).
  taking_back boolean := false;
begin
  if caller is null then
    raise exception 'reattach_member requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A saved-place identity does not reattach: it signs in. §10 — "if the
  -- membership belongs to a permanent identity, the page offers that identity's
  -- sign-in instead".
  --
  -- Three records of the same fact, and the strictest wins, which is the rule
  -- this function already applies to the *target* and had no business not
  -- applying to the caller. `auth_is_permanent()` reads the JWT, and a JWT
  -- outlives the event it describes: `linkIdentity` converts the user in place,
  -- so an access token issued minutes earlier keeps `is_anonymous: true` for the
  -- rest of its hour (§14) while `auth.users` and `profiles` have already moved
  -- on. For that hour the stale token was enough to take a *second* guest
  -- membership and attach it to a saved place, where Continue-as can never move
  -- it again.
  if public.auth_is_permanent()
    or exists (select 1 from public.profiles p where p.user_id = caller and p.is_permanent)
    or exists (
      select 1 from auth.users u where u.id = caller and not coalesce(u.is_anonymous, true)
    )
  then
    -- With one exception: the emailed link, opened by the account its membership
    -- now belongs to (§10: "if the browser already holds the right identity, it
    -- simply routes to the plan"). `linkIdentity` keeps the user id, so the token
    -- still names them. Nothing moves and nothing is spent. Anybody else signed in
    -- is refused, and the client can tell the two apart.
    if p_reentry_token_hash is not null then
      select c.* into chosen
      from private.email_action_tokens t
      join public.circle_members m
        on m.circle_id = t.membership_circle_id and m.user_id = t.membership_user_id
      join public.circles c on c.id = t.membership_circle_id
      where t.token_hash = p_reentry_token_hash
        and t.purpose = 'reentry'
        and t.membership_user_id = caller
        and m.status = 'active';

      if found then
        return chosen;
      end if;
    end if;

    raise exception 'caller_is_permanent' using errcode = 'insufficient_privilege';
  end if;

  if (p_reentry_token_hash is null) = (target is null) then
    raise exception 'reattach_member takes a target membership or a re-entry token, not both and not neither'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_reentry_token_hash is not null then
    -- Single-use, 7-day, bound to a membership (§14); spent below, in this
    -- transaction, so a later failure rolls the spend back.
    select * into token
    from private.email_action_tokens t
    where t.token_hash = p_reentry_token_hash
      and t.purpose = 'reentry'
      -- Unspent; or spent by `retire_reentry_links` when the place became a saved
      -- account's, which is the link still being the member's to use (never a link
      -- that already moved a place: that one has no `retired_at`).
      and (t.used_at is null or t.retired_at is not null)
      and t.expires_at > now();

    if not found then
      -- Before calling it invalid: a used or expired link to a membership that
      -- is now a saved place is a link to an account (§10: the page offers that
      -- identity's sign-in), and the client can only show that if told so.
      if exists (
        select 1
        from private.email_action_tokens t
        join public.profiles p on p.user_id = t.membership_user_id
        where t.token_hash = p_reentry_token_hash and t.purpose = 'reentry' and p.is_permanent
      ) then
        raise exception 'target_is_permanent' using errcode = 'insufficient_privilege';
      end if;

      raise exception 'token_invalid' using errcode = 'no_data_found';
    end if;

    target_circle := token.membership_circle_id;
    target := token.membership_user_id;
  end if;

  -- Serialises two reattachments of the same membership: without it both read
  -- a chain of two and both decide they are the third.
  select * into chosen from public.circles c where c.id = target_circle for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  if target = caller then
    -- Already theirs — but *only* if it is. This return used to come before any
    -- membership check at all, so any anonymous session that knew a circle's uuid
    -- could name itself as the target and be handed the circle: the name, the
    -- colour, the zone, the cadence, the short code. RLS refuses that same read,
    -- and §9.4 exposes the name alone and nothing else. It was also an existence
    -- oracle over circle uuids.
    --
    -- A genuine retry is served by the idempotency record before it ever reaches
    -- this function, so nothing is lost by asking.
    if not exists (
      select 1 from public.circle_members m
      where m.circle_id = target_circle and m.user_id = caller and m.status = 'active'
    ) then
      raise exception 'member_not_found' using errcode = 'no_data_found';
    end if;

    return chosen;
  end if;

  -- An archived circle is not somewhere anybody comes back to (ADR 0049), with
  -- an emailed link or without. The same answer a membership that was never
  -- there gets, so this tells nobody which of the two it was.
  if chosen.status <> 'active' then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- The list path needs a code that is live, and this function is not given one:
  -- it takes a circle and a member. So it asks the question the code would have
  -- answered (ADR 0059): has the circle a plan whose link is still a way back
  -- in (`private.plan_live_for_continue_as`)? Without this, somebody who had
  -- merely kept a circle's id and a guest's id from the time they were a member
  -- needed no code at all. Same answer as a membership that is not there. The
  -- emailed link proves an address instead, and is not asked.
  if p_reentry_token_hash is null and not exists (
    select 1 from public.plans pl
    where pl.circle_id = target_circle and private.plan_live_for_continue_as(pl.id)
  ) then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- The volume limit, **here** as well as in the Edge Function (ADR 0049): this
  -- function is granted to `authenticated`, so a client calling the RPC directly
  -- never meets the Edge Function's counters. A different scope from the Edge one,
  -- so neither eats the other's budget. A refusal raises and rolls the count back,
  -- so this bounds *completed* moves: twenty a circle an hour is far above what
  -- coming back needs and far below what taking people over needs.
  --
  -- The **list** path only. The emailed link is the way back for the rightful
  -- member, so filling the hourly budget with takeovers must not turn it away; the
  -- token has its own single-use, seven-day limit (and the Edge per-token counter).
  if p_reentry_token_hash is null and not public.take_rate_token(
    'reattach_circle_sql', extensions.digest(target_circle::text, 'sha256'), 20, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  -- `for update` on the membership itself, not only on the circle. The circle lock
  -- above serialises two reattachments; it does nothing about `claim_identity`,
  -- which locks `circle_members` rows instead. Without this, a claim running on
  -- another device could move the membership between this check and the move — and
  -- the move would match no rows while the audit row, the event and a successful
  -- answer all went out to a caller who had been given nothing.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = target and m.status = 'active'
    for update
  ) then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- Never onto a saved-place member, by either record: whichever is stale, the
  -- answer has to be no. The one exception is an emailed link that proves an address
  -- the account does not hold (ADR 0049, decision 6): that takes the place *back*.
  if exists (
    select 1 from public.profiles p where p.user_id = target and p.is_permanent
  ) or not exists (
    select 1 from auth.users u where u.id = target and coalesce(u.is_anonymous, false)
  ) then
    if p_reentry_token_hash is null
      or not private.takeback_allowed(target_circle, target, token.contact_id)
    then
      raise exception 'target_is_permanent' using errcode = 'insufficient_privilege';
    end if;
    taking_back := true;
  end if;

  -- The caller already belongs here under their own name. Moving a second
  -- membership onto them would collide with their own row, and the thing they
  -- actually want is the session they are already holding.
  if exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = caller
  ) then
    raise exception 'already_member' using errcode = 'unique_violation';
  end if;

  -- Three per membership per seven days (ADR 0006), **counting only the moves made
  -- by picking a name** (ADR 0049; `private.list_moves_this_week`). A move made with
  -- an emailed re-entry link is never refused here, a take-back from a saved account
  -- included, so a member with a live link can always return. What that leaves open
  -- is in ADR 0049, decision 4.
  if p_reentry_token_hash is null
    and private.list_moves_this_week(target_circle, target) >= 3
  then
    raise exception 'reattach_limit' using errcode = 'too_many_rows';
  end if;

  -- The move itself lives in `private.move_membership`, shared with
  -- `claim_identity`: one list of the tables a membership owns, because two
  -- lists means one of them forgets a table and a guest comes back to find
  -- their answers gone.
  if p_reentry_token_hash is not null then
    -- Spent here rather than on the way in. The early return above answers "already
    -- theirs" for somebody who follows their own link while the session still works,
    -- and burning the link for that is a link they cannot use when they actually
    -- need it. Inside the same transaction either way, so a later failure rolls the
    -- spend back with it.
    -- A retired link is now simply used, and cannot take anything back twice.
    update private.email_action_tokens t
    set used_at = coalesce(t.used_at, now()), retired_at = null
    where t.id = token.id;
  end if;

  -- A pick from the list proves nothing about who tapped it, so the previous
  -- holder's quiet-ask answer does not go to the taker (SUS-182, ADR 0062). The
  -- emailed link proved the address, so its move carries everything, as before.
  perform set_config('circles.carry_interest', case when p_reentry_token_hash is null then 'off' else 'on' end, true);

  if taking_back then
    perform private.hand_back_membership(target_circle, target, caller, token.contact_id);
  else
    perform private.move_membership(target_circle, target, caller);
  end if;

  perform set_config('circles.carry_interest', 'on', true);

  -- And the lock is not taken on trust. If the membership is not the caller's by
  -- now, something moved it and this reattachment achieved nothing — so it says
  -- so, rather than announcing a rejoin that did not happen.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = caller and m.status = 'active'
  ) then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- Ids only (non-negotiable 8). The two ids are what makes the chain above
  -- walkable, and `source` ('list' or 'email') is what lets the cap above count
  -- only the moves it is for; a display name here would be the leak the
  -- constraint on this table refuses anyway.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_reattached', 'circle', target_circle,
          jsonb_build_object('from_user_id', target, 'to_user_id', caller, 'source', entry_source,
                             'from_saved_account', taking_back));

  -- The owner's "Priya rejoined from a new device" (spec §5.1) starts here.
  -- No name: the notification pipeline reads the roster for that.
  -- A place taken back from a saved account is told the same way, with the account's
  -- id on the event so both parties are named: no new channel (ADR 0049, 6).
  perform jobs.emit('circles.member_reattached', 'circle', target_circle,
    jsonb_build_object('circle_id', target_circle, 'user_id', caller, 'source', entry_source)
    || case when taking_back
         then jsonb_build_object('from_user_id', target, 'from_saved_account', true)
         else '{}'::jsonb end);

  return chosen;
end;
$$;

comment on function public.reattach_member(uuid, uuid, bytea) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list or an emailed re-entry token (ADR 0006). Only in an active circle, and on the list path only while one of its plans is live (ADR 0059); a per-circle hourly limit on the list path; at most three list moves per membership per seven days, and a move made with a valid re-entry token is never refused by that cap (ADR 0049); never onto a saved-place member; but a valid re-entry token takes a place back from a saved account whose own address is not the link''s, moving that circle only (ADR 0049, decision 6).';

revoke all on function public.reattach_member(uuid, uuid, bytea) from public;
revoke all on function public.reattach_member(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.reattach_member(uuid, uuid, bytea) to authenticated;

-- END GENERATED: function definitions
