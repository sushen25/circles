-- 0059_invite_digest_is_not_a_credential
--
-- (Numbered 0059, not the 0058 `pnpm gen:migration` suggests: open pull
-- requests hold 0055 to 0057 and 0058 may go to another ticket.)
--
-- The database keeps only the SHA-256 of an invite secret and of a re-entry
-- token (ADR 0028, architecture §14), so that a copy of it is not a set of
-- working links. But `redeem_invite` and the token form of `reattach_member`
-- took that digest and were granted to `authenticated`, so anybody holding a
-- copy of `circle_invites` or `email_action_tokens` could call them with a
-- stored digest and join a circle, or take over a guest's place, without
-- knowing a secret.
--
-- Both now belong to the service role and are called only by their Edge
-- Functions, which hash the secret and pass the person they verified from the
-- JWT (the `join_from_plan` / `claim_identity` shape):
--
--   * `redeem_invite(p_user_id, p_secret_hash, p_display_name)`;
--   * `reattach_with_token(p_user_id, p_reentry_token_hash)`, split out of
--     `reattach_member`, which keeps the Continue-as list form
--     `(p_circle_id, p_target_user_id)` for `authenticated`. Both doors share
--     `private.reattach_member_core`, so there is still one body;
--   * `live_invite(p_circle_id, p_user_id)`, so the digest no longer reaches
--     an owner's client either.
--
-- The per-caller limit #192 put inside `redeem_invite` (`redeem_invite_sql`)
-- is now keyed on `p_user_id`, which only the service role can name.
--
-- Uniqueness of `circle_invites.secret_hash` across circles is 0044's
-- `circle_invites_secret_hash_key`, which this does not touch.

drop function public.redeem_invite(bytea, text);
drop function public.reattach_member(uuid, uuid, bytea);
drop function public.live_invite(uuid);

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/private/reattach_member_core.sql
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
  -- Three records of the same fact, and the strictest wins, which is the rule
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

-- supabase/sql/functions/public/invite_preview.sql
-- ---------------------------------------------------------------------------
-- What the Join page shows before anybody has joined (spec §5.1, S1-24).
--
-- "Before any prompt the page shows: circle name, inviter's name, who is in so
-- far." A visitor holding an invite link has no session and no membership, so
-- RLS shows them nothing — and asking them to sign in, even anonymously, before
-- they have seen what they are being asked to join is the prompt §5.1 says must
-- not come first. So this answers the `anon` role.
--
-- **What authorises it is the secret.** Keyed by its SHA-256, exactly as
-- `redeem_invite` is, so the capability itself never becomes a statement
-- parameter (§14). The client hashes the fragment in the browser; the digest
-- is not a way in: `redeem_invite` is the service role's, called by the
-- `redeem-invite` Edge Function, which takes the secret and hashes it itself
-- (SUS-114). Whoever holds a digest can learn only what this returns, which is
-- the least the Join page draws. A 256-bit secret is not a
-- space anybody walks, which is why there is no rate limit here where
-- `guest_members_for_reattach`, keyed by a short code, has one.
--
-- **What it returns is the least that draws the page.** The circle's name; the
-- name of whoever made the link, when they are still a member; and one initial
-- per active member, which is what the member marks render. Not names: the
-- page is shown to somebody who has not joined, and a link forwarded beyond the
-- group should not hand a stranger the roster. Not a plan, not a date, nothing
-- from a quiet ask — the same line `preview_for_code` holds.
--
-- A revoked invite, an unknown digest and an archived circle all return no
-- row, for the reason `redeem_invite` gives all three one error: the caller is
-- not entitled to know which. The page says "this link isn't active".
-- ---------------------------------------------------------------------------

create or replace function public.invite_preview(p_secret_hash bytea)
returns table (circle_name text, inviter_name text, member_initials text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.name,
    -- The inviter by their name *in this circle*, and only while they are in
    -- it: a link made by somebody who has since been removed should not keep
    -- announcing them.
    (
      select m.display_name_snapshot
      from public.circle_members m
      where m.circle_id = c.id and m.user_id = i.created_by and m.status = 'active'
    ),
    coalesce(
      (
        select array_agg(upper(left(m.display_name_snapshot, 1)) order by m.joined_at, m.user_id)
        from public.circle_members m
        where m.circle_id = c.id and m.status = 'active'
      ),
      '{}'
    )
  from public.circle_invites i
  join public.circles c on c.id = i.circle_id
  where i.secret_hash = p_secret_hash
    and i.revoked_at is null
    and c.status = 'active';
$$;

comment on function public.invite_preview(bytea) is
  'The Join page before joining: circle name, inviter name and one initial per member, by invite digest. No row for a revoked or unknown invite or an archived circle.';

revoke all on function public.invite_preview(bytea) from public;
grant execute on function public.invite_preview(bytea) to anon, authenticated;

-- supabase/sql/functions/public/live_invite.sql
-- ---------------------------------------------------------------------------
-- The circle's live invite, as its owner may know it (S1-23, ADR 0028).
--
-- `get-invite-link` shows the owner their link again. The secret is not stored
-- — only its SHA-256 is (§14) — so the Edge Function *derives* it from the
-- invite's id with a key the database never sees, and checks the derivation
-- against the digest before handing anything back. This is the half the
-- database can answer: which invite is live, and what its digest is.
--
-- The owner's alone, by the rule `issue_invite` follows: handing out the way
-- in is the one circle decision spec §5.2 gives to the owner. A member who is
-- not the owner is refused rather than answered with nothing, so the screen can
-- tell "you may not" from "there is no link".
--
-- **The service role's, not the client's (SUS-114).** The digest is not the
-- secret, but it was a way in, and an owner's client has no use for it:
-- only `get-invite-link` compares it. So that function calls this with the
-- owner it verified from the JWT as `p_user_id`, and the digest stops at the
-- server. (The owner check is `auth_is_owner`'s, restated for a caller who is
-- an argument rather than `auth.uid()`.)
--
-- No row when the circle has no live invite: a circle made without one (the
-- fixtures do that) has nothing to show until the owner resets it.
-- ---------------------------------------------------------------------------

create or replace function public.live_invite(p_circle_id uuid, p_user_id uuid)
returns table (invite_id uuid, secret_hash bytea)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'live_invite requires the owner asking'
      using errcode = 'insufficient_privilege';
  end if;

  -- As `auth_is_owner`, this asks for an *active* owner: an owner who has left owns
  -- nothing, and an id that is not a circle is simply not theirs.
  if not exists (
    select 1
    from public.circles c
    join public.circle_members m
      on m.circle_id = c.id and m.user_id = c.owner_user_id and m.status = 'active'
    where c.id = p_circle_id and c.owner_user_id = p_user_id
  ) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.secret_hash
    from public.circle_invites i
    where i.circle_id = p_circle_id and i.revoked_at is null;
end;
$$;

comment on function public.live_invite(uuid, uuid) is
  'The id and digest of a circle''s live invite, if p_user_id owns the circle, so get-invite-link can re-derive the secret (ADR 0028). Never the secret: the database does not have it. Service role only: the digest does not reach a client (SUS-114).';

revoke all on function public.live_invite(uuid, uuid) from public;
revoke all on function public.live_invite(uuid, uuid) from anon, authenticated;
grant execute on function public.live_invite(uuid, uuid) to service_role;

-- supabase/sql/functions/public/reattach_member.sql
-- ---------------------------------------------------------------------------
-- reattach_member — the Continue-as list
--
-- A guest comes back with no session — the expected path, not the rare one
-- (ADR 0006: Safari drops script-writable storage after seven idle days, and
-- chat in-app browsers isolate it). They sign in anonymously again, pick their
-- name from the Continue-as list, and this moves the membership and everything
-- scoped to it onto the new identity.
--
-- The list names the membership and asks for nothing else, so this door stays
-- the caller's: it acts on `auth.uid()` and its limits and safeguards are
-- `private.reattach_member_core`'s. The emailed link is the other door,
-- `reattach_with_token`, and is not reachable from here: a re-entry digest in
-- this function's arguments is gone since SUS-114.
-- ---------------------------------------------------------------------------

create or replace function public.reattach_member(
  p_circle_id uuid default null,
  p_target_user_id uuid default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.reattach_member_core((select auth.uid()), p_circle_id, p_target_user_id, null);
end;
$$;

comment on function public.reattach_member(uuid, uuid) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list (ADR 0006). The emailed re-entry link is reattach_with_token, the service role''s. Only in an active circle and only while one of its plans is live (ADR 0059); a per-circle hourly limit; at most three moves per membership per seven days (ADR 0049); never onto a saved-place member.';

revoke all on function public.reattach_member(uuid, uuid) from public;
revoke all on function public.reattach_member(uuid, uuid) from anon, authenticated;
grant execute on function public.reattach_member(uuid, uuid) to authenticated;

-- supabase/sql/functions/public/reattach_with_token.sql
-- ---------------------------------------------------------------------------
-- reattach_with_token — the emailed way back
--
-- The token form of reattachment (ADR 0006, §10): a guest follows the `/a/<token>`
-- link from an email and this moves their membership onto the session they hold.
--
-- **The service role's, and nobody else's.** The table keeps only the SHA-256 of
-- the token, so if the digest were enough to call this, a copy of
-- `private.email_action_tokens` (a backup, an export, a read-only SQL user)
-- would be a set of working re-entries, some able to take places back from
-- saved accounts (ADR 0049, decision 6). So the `reattach-member` Edge Function
-- hashes the token it was sent and passes the digest with the caller it
-- verified from the JWT: the same shape as `join_from_plan` and
-- `claim_identity`. Why the digest is computed there and not in SQL: handing
-- this function the token itself would put the capability in a statement
-- parameter, which is what architecture §14 keeps out of query logs.
--
-- `p_user_id` is who is coming back. It can be trusted because only the service
-- role can say it, and the Edge Function takes it from the verified JWT, never
-- from the body. The JWT is not read here: the service role's is not the
-- person's, so the stale-token check in the core relies on the two database
-- records alone, which are current.
-- ---------------------------------------------------------------------------

create or replace function public.reattach_with_token(
  p_user_id uuid,
  p_reentry_token_hash bytea
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'reattach_with_token requires the person coming back'
      using errcode = 'insufficient_privilege';
  end if;

  return private.reattach_member_core(p_user_id, null, null, p_reentry_token_hash);
end;
$$;

comment on function public.reattach_with_token(uuid, bytea) is
  'Moves a guest membership onto p_user_id from an emailed re-entry token digest (ADR 0006, ADR 0049). Service role only: the digest is stored, so it must not be a way in by itself, and the reattach-member Edge Function that hashes the token passes the caller it verified.';

revoke all on function public.reattach_with_token(uuid, bytea) from public;
revoke all on function public.reattach_with_token(uuid, bytea) from anon, authenticated;
grant execute on function public.reattach_with_token(uuid, bytea) to service_role;

-- supabase/sql/functions/public/redeem_invite.sql
-- ---------------------------------------------------------------------------
-- redeem_invite
--
-- The only way a membership is created from an invite link (§9.1). A definer
-- function rather than an insert policy, for the reason `create_circle` is
-- one: joining is several writes that have to be one — the membership, the use
-- count, and two checks that are only true if nobody else joins between them.
--
-- **The secret never arrives here.** The Edge Function hashes the link
-- fragment with SHA-256 and passes the digest, so the capability itself is
-- never a statement parameter and cannot reach a query log (§14: tokens are
-- "never logged"). The digest finds the invite; the row it finds is the
-- authority.
--
-- **The service role's, and nobody else's (SUS-114).** The table keeps only the
-- SHA-256 of the secret, so if that digest were enough to call this, a copy of
-- `public.circle_invites` would be a set of working links into every circle,
-- which is what ADR 0028 chose to hash the secrets to avoid. So only the
-- `redeem-invite` Edge Function may call it, the way `join_from_plan` is
-- called: it passes the person it verified from the JWT as `p_user_id`, never
-- anything out of the request body, and the membership lands on that person.
--
-- What this function enforces is what the database would refuse whoever
-- asked: the invite must be live, the cap holds, the name must be free.
-- Turnstile and the per-address limit live in the Edge Function because they
-- are abuse controls rather than authorisation.
--
-- Idempotent by its own state rather than by a key column: being an active
-- member of the circle *is* the record that this already happened, so a retry
-- returns the circle and writes nothing. (`create_circle` carries a
-- `creation_key` because a circle has no such natural record — asking twice
-- would leave two circles and no way to tell which link was shared.)
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(
  p_user_id uuid,
  p_secret_hash bytea,
  p_display_name text
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := p_user_id;
  invite public.circle_invites;
  target public.circles;
begin
  if caller is null then
    raise exception 'redeem_invite requires the person joining'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds whatever the Edge Function did. Keyed on the person
  -- joining, `p_user_id`, which only the service role can name and which the
  -- Edge Function takes from the verified JWT: never on an id a client could
  -- choose, which would let anybody spend somebody else's allowance. Sized far
  -- above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'redeem_invite_sql', extensions.digest(caller::text, 'sha256'), 120, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  -- `invite_inactive` is one error for three causes — no such secret, revoked,
  -- or a circle that has since gone — because the caller is not entitled to
  -- know which. The LinkInvalid screen says the same thing to all three.
  select * into invite
  from public.circle_invites i
  where i.secret_hash = p_secret_hash and i.revoked_at is null;

  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- Serialises concurrent joins. `enforce_member_cap` takes the same lock, and
  -- taking it here too means the duplicate-name check and the cap see one
  -- roster rather than two.
  select * into target from public.circles c where c.id = invite.circle_id for update;
  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- The cap, the name and rejoining after removal are the same for every way
  -- into a circle, and live in `private.admit_member` so that they stay the
  -- same (ADR 0022 added a second way in). What is this function's own is the
  -- invite, and counting its use — once, and not for somebody who was already
  -- in: a retry, a second tap, or the link opened twice in one browser.
  if private.admit_member(target.id, caller, p_display_name) then
    update public.circle_invites i
    set use_count = i.use_count + 1
    where i.id = invite.id;
  end if;

  return target;
end;
$$;

comment on function public.redeem_invite(uuid, bytea, text) is
  'Joins p_user_id to the circle behind an invite digest. Idempotent on an existing active membership; raises invite_inactive, duplicate_name or circle_full. Service role only: the digest is stored, so it must not be a way in by itself, and the redeem-invite Edge Function that hashes the secret passes the caller it verified (SUS-114).';

revoke all on function public.redeem_invite(uuid, bytea, text) from public;
revoke all on function public.redeem_invite(uuid, bytea, text) from anon, authenticated;
grant execute on function public.redeem_invite(uuid, bytea, text) to service_role;

-- END GENERATED: function definitions
