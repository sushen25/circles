-- ---------------------------------------------------------------------------
-- private.reattach_member_core
--
-- Everything a reattachment decides, for the person it is done *for*. The two
-- public doors take their caller differently and share this body so that they
-- cannot drift apart:
--
--   * `public.reattach_member(circle, member)` — the Continue-as list. Granted
--     to `authenticated`; the caller is `auth.uid()`.
--   * `public.reattach_with_token(user, token digest)` — the emailed re-entry
--     link. The service role's: the Edge Function hashes the token and passes
--     the verified caller. The digest is therefore not a way in on its own
--     (SUS-114): a copy of `private.email_action_tokens` cannot be replayed over
--     RPC, because nobody who is not the service role may call this door.
--
-- Not granted to any client role.
--
-- The story, the safeguards and the reasons are the ones this function has
-- always carried; they are repeated nowhere else.
--
-- **The old identity is not deleted here.** It can hold memberships in other
-- circles; `circles.owner_user_id`, `circle_invites.created_by` and
-- `plans.organiser_user_id` reference `auth.users` with no action, so a delete
-- can *fail* at the worst moment; and `run_retention` already deletes anonymous
-- identities with no memberships after thirty days (ADR 0014, §8.5).
-- ---------------------------------------------------------------------------

create or replace function private.reattach_member_core(
  p_caller uuid,
  p_circle_id uuid,
  p_target_user_id uuid,
  p_reentry_token_hash bytea
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := p_caller;
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
  -- Three records of the same fact on the list path (two on the token path,
  -- where the JWT is the service role's and not the person's), and the strictest wins, which is the rule
  -- this function already applies to the *target* and had no business not
  -- applying to the caller. `auth_is_permanent()` reads the JWT, and a JWT
  -- outlives the event it describes: `linkIdentity` converts the user in place,
  -- so an access token issued minutes earlier keeps `is_anonymous: true` for the
  -- rest of its hour (§14) while `auth.users` and `profiles` have already moved
  -- on. For that hour the stale token was enough to take a *second* guest
  -- membership and attach it to a saved place, where Continue-as can never move
  -- it again.
  if ((select auth.uid()) = caller and public.auth_is_permanent())
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
  -- list form is granted to `authenticated`, so a client calling the RPC directly
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

comment on function private.reattach_member_core(uuid, uuid, uuid, bytea) is
  'Moves a guest membership and everything scoped to it onto p_caller, from the Continue-as list (a circle and a member) or an emailed re-entry token digest (ADR 0006): only in an active circle, and on the list path only while one of its plans is live (ADR 0059); a per-circle hourly limit on the list path; at most three list moves per membership per seven days, and a move made with a valid re-entry token is never refused by that cap (ADR 0049); never onto a saved-place member, but a valid token takes a place back from a saved account whose own address is not the link''s (ADR 0049, decision 6). Called only by reattach_member and reattach_with_token, which say who p_caller is.';

revoke all on function private.reattach_member_core(uuid, uuid, uuid, bytea) from public;
revoke all on function private.reattach_member_core(uuid, uuid, uuid, bytea) from anon, authenticated;
