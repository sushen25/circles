-- ---------------------------------------------------------------------------
-- 0033 — Continue-as resolves a code only while it is live, and its limits are
-- enforced in SQL (SUS-103, ADR 0048).
--
-- Three things in the identity-continuity functions went further than ADR 0006
-- and ADR 0022 accepted: any plan code a circle had ever had listed its guests
-- for ever; the per-circle limits lived only in the Edge Function, so a direct
-- RPC call met none; and the three-per-week cap counted a member's own way
-- back, so it could be spent against them.
--
--   * `private.continue_as_window`, `private.circles_open_to_continue_as` — the
--     one rule for when a code still offers Continue-as: a circle code while
--     the circle is active; a plan code while the circle is active and the plan
--     is `collecting` or `ready`, or `confirmed` / `completed` and its meetup
--     ended fewer than fourteen days ago.
--   * `public.guest_members_for_reattach` and `public.preview_for_code` read it.
--   * `public.reattach_member` — refuses unless the circle is active; a
--     per-circle hourly limit on the list path through `take_rate_token`; the cap
--     counts the moves that proved nothing, and a move made with an emailed
--     re-entry token for an address that was on the place before the week's
--     first counted move is never refused by it. The audit row records `capped`
--     (and `source`) so the cap can tell.
--
-- No table changes: the audit row's `metadata` is a document, and older rows
-- without `capped` are counted.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/private/circles_open_to_continue_as.sql
-- ---------------------------------------------------------------------------
-- The circle (if any) a short code may still be used to Continue-as in
-- (spec §5.1, ADR 0048).
--
-- A code is not a key forever. ADR 0006 accepted that Continue-as needs no
-- owner approval, and ADR 0022 accepted a plan code in URLs and logs because it
-- "admits for days, not for good" — so the list a code opens has to stop with
-- the code's life, and this is the one place that says when:
--
--   * a **circle** code: while the circle is `active`;
--   * a **plan** code: while the circle is `active` and the plan is
--     `collecting` or `ready`, or has been locked in (`confirmed`, and
--     `completed` once the outcome is in) and its meetup ended less than
--     `private.continue_as_window()` ago. `completed` is the same plan the
--     morning after: refusing it would shut the people who come back to say
--     "I was there" out the moment the organiser answered the question;
--   * never for a `cancelled` or `expired` plan, nor for a quiet ask that has
--     not found its footing (`draft`, `seeking`: those are never shared by
--     link, §5.4), nor for an archived circle.
--
-- Empty for a code that matches none of these, and the caller cannot tell
-- "unknown" from "no longer live", which is the point.
-- ---------------------------------------------------------------------------

create or replace function private.circles_open_to_continue_as(p_short_code text)
returns setof uuid
-- plpgsql, not sql, so `continue_as_window` is looked up when this runs and not when
-- it is created: the generated block renders files in name order, and this one
-- sorts before the function it reads.
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select c.id
  from public.circles c
  where c.short_code = p_short_code and c.status = 'active'
  union
  select c.id
  from public.plans pl
  join public.circles c on c.id = pl.circle_id
  where pl.short_code = p_short_code
    and c.status = 'active'
    and (
      pl.state in ('collecting', 'ready')
      or (
        pl.state in ('confirmed', 'completed')
        and exists (
          select 1 from public.meetup_confirmations mc
          where mc.plan_id = pl.id
            and mc.revision = pl.revision
            and mc.status in ('active', 'completed')
            and now() < mc.ends_at + private.continue_as_window()
        )
      )
    );
end;
$$;

revoke all on function private.circles_open_to_continue_as(text) from public;
revoke all on function private.circles_open_to_continue_as(text) from anon, authenticated;

-- supabase/sql/functions/private/continue_as_window.sql
-- ---------------------------------------------------------------------------
-- How long after a meetup its plan's link still offers Continue-as (ADR 0048).
--
-- One number, in one place, because three things read it and they must agree:
-- the list a guest picks their name from, the link-preview's circle name that
-- decides whether the screen says "this link isn't active", and the pgTAP that
-- proves the edge. Measured from the meetup's *end*, because that is when the
-- morning-after question and "I was there" open (spec §5.10).
--
-- Fourteen days: the morning-after letter goes out at nine the next morning,
-- and an organiser or a guest answering it a week late is ordinary; a second
-- week covers the guest whose Safari dropped its storage after seven idle days
-- (ADR 0006) and who opens the old link from the chat on the way back. After
-- that the plan's link is a forwarded screenshot, not somebody's way back, and
-- the emailed re-entry link still works for anybody who gave an address.
-- ---------------------------------------------------------------------------

create or replace function private.continue_as_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '14 days';
$$;

revoke all on function private.continue_as_window() from public;
revoke all on function private.continue_as_window() from anon, authenticated;

-- supabase/sql/functions/public/guest_members_for_reattach.sql
-- ---------------------------------------------------------------------------
-- The "Continue as" list (spec §5.1, ADR 0006).
--
-- Somebody opens a circle or plan link with no session, or with a session that
-- holds no membership of that circle. To offer "Continue as Priya" the page
-- needs the circle's guest names — and nothing else. Display names only: no
-- reply state, no email flag, no join time. That is not a nicety, it is the
-- constraint ADR 0006 wrote down ("the continue-as list must never show reply
-- status or email presence"), because the list is shown before anybody has
-- proved they belong here.
--
-- Keyed by short code rather than circle id, like the link-preview route
-- (§9.4): the short code is what the person actually has.
--
-- And it hands the circle id *back*, because `reattach_member` needs one and a
-- session that has just signed in anonymously has no way to get it: RLS shows it no
-- circle it is not a member of, and nothing else maps a code to an id. Without this
-- the sequence §10 describes — call the list, then call `reattach-member` with what
-- it returned — could not be completed by the client the contract is written for.
-- The pgTAP tests missed it by passing a circle id from a `postgres`-side fixture;
-- no client can do that. It reveals nothing: the caller already holds the code, and
-- needs the id to make the very next call.
--
-- Granted to `authenticated` only, which includes an anonymous session but not
-- the `anon` role. A visitor arriving with no session at all signs in
-- anonymously first — the client has to do that anyway before it can reattach,
-- so it costs the flow nothing.
--
-- That grant is **not** a volume control, and this comment used to claim it was:
-- "scraping costs one anonymous identity per attempt". It does not. One
-- anonymous session can call this as often as it likes with as many short codes
-- as it likes, and Supabase's per-IP signup limit never comes into it. So the
-- limit is here, in the function, where a client calling the RPC directly meets
-- it too: thirty lookups per caller per hour, which is far more than a person
-- opening a link will ever need and far less than a scrape.
--
-- Saved-place members are excluded, so the list never names somebody this
-- function could not then be used to reattach to.
--
-- **A code opens the list only while it is live** (ADR 0048): the circle's own
-- code while the circle is active; a plan's code while the plan is asking or
-- options are on offer, or locked in and the meetup ended less than fourteen
-- days ago; never for a cancelled or expired plan or an archived circle. The
-- rule is `private.circles_open_to_continue_as`, shared with the link
-- preview, so what the screen calls "not active" and what this refuses are
-- one decision. This used to match any plan the circle had ever had, so an old
-- forwarded link listed every guest for ever.
--
-- The list still carries each person's user id rather than an opaque handle, so
-- the id remains what `reattach_member` is called with. What bounds that is
-- there, not here — the circle must be active, the per-circle limit and the
-- cap apply to a direct call — and ADR 0048 says why a handle was not worth
-- its cost and what is left over.
-- ---------------------------------------------------------------------------

-- `volatile`, not `stable`, because counting a lookup is a write. The cost is a
-- function the planner cannot fold into a surrounding query; the benefit is that
-- the limit cannot be skipped by the one caller it is meant for.
create or replace function public.guest_members_for_reattach(p_short_code text)
returns table (circle_id uuid, member_user_id uuid, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'guest_members_for_reattach requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.take_rate_token(
    'roster_lookup', extensions.digest(caller::text, 'sha256'), 30, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  return query
  select m.circle_id, m.user_id, m.display_name_snapshot
  from public.circle_members m
  join public.circles c on c.id = m.circle_id
  join public.profiles p on p.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  where c.id in (select private.circles_open_to_continue_as(p_short_code))
    and m.status = 'active'
    -- Two records of one fact, and the stricter reading wins. `profiles` is
    -- the durable record `handle_user_updated` maintains; `auth.users` is
    -- Supabase's own. A row where they disagree is a row this list must not
    -- name, whichever of the two is the stale one — "a saved-place member can
    -- never be reattached to" is a privacy invariant, not a preference.
    and not p.is_permanent
    and u.is_anonymous
  order by m.display_name_snapshot, m.user_id;
end;
$$;

comment on function public.guest_members_for_reattach(text) is
  'The Continue-as list: display names of a circle''s guest members, by short code. Never reply state, never email presence (ADR 0006).';

revoke all on function public.guest_members_for_reattach(text) from public;
revoke all on function public.guest_members_for_reattach(text) from anon, authenticated;
grant execute on function public.guest_members_for_reattach(text) to authenticated;

-- supabase/sql/functions/public/preview_for_code.sql
-- ---------------------------------------------------------------------------
-- The circle's name, for a link preview, to anybody at all.
--
-- A link pasted into a group chat is fetched by WhatsApp, Messenger, Slack and
-- iMessage before a person taps it, with no session and no cookies, and the
-- card they draw is the first thing everybody in that chat sees. So this answers
-- an unauthenticated stranger — one of two functions that do, with
-- `invite_preview`, which needs the invite's secret where this needs only a code.
--
-- What it answers is the circle's **name** and nothing else (architecture §9.4:
-- "circle name only. Never member names, dates chosen, or anything from a quiet
-- ask"). Not a signature that could carry more later, either: the return is one
-- `text`, so there is no field for a plan's title to be added to in six months
-- by somebody who did not read this comment. `ogTitle(circleName)` in the
-- domain takes the same care with the same reasoning.
--
-- Quiet asks are the case that makes the rule sharp. A quiet ask exists to hide
-- that somebody wants to organise something; a preview card naming the plan
-- would tell the whole chat, including people who are not in the circle.
--
-- Unknown code and archived circle answer the same as a code that never
-- existed: null. Telling them apart would let somebody walk the short-code
-- space and learn which circles exist.
-- ---------------------------------------------------------------------------

create or replace function public.preview_for_code(p_kind text, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  circle_name text;
begin
  -- `/join` carries its secret in the fragment, which is never sent to a
  -- server, so there is no code to look up and nothing to preview but the
  -- generic card. That is the property, not an oversight: the one link that
  -- grants circle membership cannot be resolved by anything that only saw the
  -- URL, this function included.
  if p_kind not in ('j', 'p') then
    return null;
  end if;

  -- Shape first, so a scan with rubbish never reaches the tables. The
  -- short-code alphabet has no `i`, `l`, `o`, `0` or `1` in it.
  if p_code is null or p_code !~ '^[a-hjkmnp-z2-9]{6,12}$' then
    return null;
  end if;

  -- `/j/<code>` and `/p/<code>` are the same plan seen twice — the link you
  -- paste into the chat and the page it opens (architecture §5) — so both
  -- resolve through `plans.short_code` and both answer with the circle's name.
  --
  -- Only while the code is live (ADR 0048, `private.circles_open_to_continue_as`):
  -- the same answer a code that never existed gets, so a cancelled or expired
  -- plan, an archived circle and a plan whose meetup is long past all draw the
  -- generic card — and the Continue-as screen, which asks this for its title,
  -- reads that null as "this link isn't active".
  select c.name into circle_name
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.short_code = p_code
    and c.id in (select private.circles_open_to_continue_as(p_code));

  return circle_name;
end;
$$;

comment on function public.preview_for_code(text, text) is
  'The circle name behind a plan or invite short code, for a link-preview card, or null. Answers an unauthenticated stranger, knowing only a short code; it returns a name and has no field anything else could be added to (architecture §9.4).';

revoke all on function public.preview_for_code(text, text) from public;
grant execute on function public.preview_for_code(text, text) to anon, authenticated, service_role;

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
-- must be a guest, and a membership may move at most three times in seven days.
-- "A reattachment moves a membership only within a circle the guest already
-- belongs to, never onto a saved-place member" is an AGENTS.md privacy
-- invariant, so it is enforced where it cannot be skipped.
--
-- **The old identity is not deleted here.** The ticket asked for that; three
-- things say otherwise. An anonymous identity can hold memberships in more than
-- one circle, and deleting it would cascade away the ones this reattachment did
-- not touch. `circles.owner_user_id`, `circle_invites.created_by` and
-- `plans.organiser_user_id` reference `auth.users` with no action, so a delete
-- can *fail* — turning a lost session into a guest who cannot get back in, at
-- the worst possible moment. And retention already owns this: `run_retention`
-- deletes anonymous identities with no memberships after thirty days
-- (ADR 0014, §8.5), which is precisely what this one becomes.
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
  moves integer;
  first_counted timestamptz;
  token_verified timestamptz;
  established boolean := false;
  -- `member_reattached`'s analytics payload is `source: 'list' | 'email'`
  -- (packages/contracts/src/analytics.ts), and the reattach rate by source is
  -- what tells us whether the emailed path is worth its machinery. The function
  -- is the only place that knows which one happened.
  entry_source text := case when p_reentry_token_hash is null then 'list' else 'email' end;
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
    -- now belongs to. §10 — "if the browser already holds the right identity, it
    -- simply routes to the plan". A guest who saved their place keeps the same
    -- user id (`linkIdentity` converts in place), so the token still names them.
    -- Nothing moves and nothing is spent: they are handed the circle they are
    -- already an active member of, which RLS would show them anyway. Anybody
    -- else signed in is still refused, and the client can now tell the two apart
    -- — before, both were `caller_is_permanent`, and the right account was told
    -- its own link was for somebody else.
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
    -- Single-use, 7-day, bound to a membership (§14). Spent whether or not the
    -- rest succeeds is wrong — so it is spent here, inside the same
    -- transaction, and a later failure rolls the spend back with it.
    select * into token
    from private.email_action_tokens t
    where t.token_hash = p_reentry_token_hash
      and t.purpose = 'reentry'
      and t.used_at is null
      and t.expires_at > now();

    if not found then
      -- Before calling it invalid: a token whose membership has since become a
      -- saved place is not a broken link, it is a link to an account. §10 — "if
      -- the membership belongs to a permanent identity, the page offers that
      -- identity's sign-in instead" — and the client can only show that if it is
      -- told which of the two happened. Saying so to the holder of the emailed
      -- token reveals nothing they did not already have.
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

  -- An archived circle is not somewhere anybody comes back to (ADR 0048), with
  -- an emailed link or without. The same answer a membership that was never
  -- there gets, so this tells nobody which of the two it was.
  if chosen.status <> 'active' then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- The volume limit, **here** as well as in the Edge Function (ADR 0048). This
  -- function is granted to `authenticated`, which includes any anonymous
  -- session, so a client that calls the RPC directly never meets the Edge
  -- Function's counters; this is the one it cannot skip. A different scope from
  -- the Edge one on purpose: that layer stays the outer limit and neither eats
  -- the other's budget.
  --
  -- A refusal raises, and raising rolls the count back with the statement, so
  -- what this bounds is *completed* moves, which is what hurts anybody. Twenty a
  -- circle an hour is far above what coming back needs (a guest moves once) and
  -- far below what taking people over needs.
  --
  -- The **list** path only. The emailed link is the way back for the rightful
  -- member, so somebody else filling a circle's hourly budget with takeovers must
  -- not be able to turn it away; the token has its own single-use, seven-day
  -- limit instead (and the Edge Function's per-token counter).
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

  -- Never onto a saved-place member. Both records are read, and the stricter
  -- wins, for the reason `guest_members_for_reattach` reads both: whichever of
  -- them is stale, the answer has to be no.
  if exists (
    select 1 from public.profiles p where p.user_id = target and p.is_permanent
  ) or not exists (
    select 1 from auth.users u where u.id = target and coalesce(u.is_anonymous, false)
  ) then
    raise exception 'target_is_permanent' using errcode = 'insufficient_privilege';
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

  -- Three per membership per seven days (ADR 0006), **counting the moves that
  -- proved nothing** (ADR 0048). Counting is not a simple `where user_id = target`:
  -- every reattachment *changes* the membership's user id, so the previous ones are
  -- recorded against identities this one has never seen. The audit rows form a
  -- chain — each names the identity it moved from and the one it moved to — and the
  -- membership's history is the walk backwards along it.
  --
  -- Why not every move. The cap exists to stop a name being passed back and forth
  -- by people who prove nothing. It used to count the member's own moves as well,
  -- so somebody who took a place, let its owner take it back, and took it again
  -- left the owner — with a valid emailed link in hand — refused for a week, and
  -- the only remedy was removing the membership, which deletes their answers.
  --
  -- So a move made with an emailed re-entry token is **established**, and neither
  -- counted nor refused, when the address it was sent to was verified *before the
  -- first counted move of the week* — an address that was on the place
  -- before anybody took it. An address verified after that (by whoever held the
  -- place since, which they may do, and which then travels with the membership
  -- because contacts do) proves nothing about the person it was sent to, so a move
  -- made with it is counted like a pick from the list and refused at the cap.
  -- With no counted move in the week there is nothing to be established against,
  -- and any live link is established.
  --
  -- What is left, said plainly: an address attached to a place more than a week
  -- before the move that uses it is established, and links are minted by the
  -- letters the product sends (one per address per letter, seven days), which
  -- neither side controls — so two people who both hold such an address can trade
  -- a place back and forth as often as letters arrive, each move telling the owner.
  -- That is a stalemate, never a lockout: the rightful member's own link is always
  -- established. ADR 0048 records it.
  --
  -- Rows written without `capped` count (the stricter reading, for a window that
  -- closes in seven days).
  --
  -- `union`, not `union all`, and the row's own id in the result — because the
  -- chain can be a *cycle*. A membership moves A→B, and later, from the session
  -- on device A that is still valid, B→A. The history then loops A→B→A→B, and
  -- `union all` follows it until the statement is cancelled or the server runs
  -- out of memory. `union` discards a row already in the result, so revisiting
  -- the same audit row ends the recursion; carrying the id keeps two genuinely
  -- separate moves between the same pair of identities counted as two.
  with recursive chain (id, from_id, to_id, capped, at) as (
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
           coalesce(a.metadata ->> 'capped', 'true') = 'true', a.occurred_at
    from private.audit_log a
    where a.action = 'circles.member_reattached'
      and a.resource_id = target_circle
      and a.occurred_at > now() - interval '7 days'
      and a.metadata ->> 'to_user_id' = target::text
    union
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
           coalesce(a.metadata ->> 'capped', 'true') = 'true', a.occurred_at
    from private.audit_log a
    join chain on a.metadata ->> 'to_user_id' = chain.from_id
    where a.action = 'circles.member_reattached'
      and a.resource_id = target_circle
      and a.occurred_at > now() - interval '7 days'
  )
  select count(*) filter (where capped), min(at) filter (where capped)
  into moves, first_counted
  from chain;

  if p_reentry_token_hash is not null then
    select c.verified_at into token_verified
    from private.email_contacts c where c.id = token.contact_id;

    established := moves = 0
      or (token_verified is not null and token_verified < first_counted);
  end if;

  if not established and moves >= 3 then
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
    update private.email_action_tokens t set used_at = now() where t.id = token.id;
  end if;

  perform private.move_membership(target_circle, target, caller);

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
  -- walkable, and `capped` is what lets the cap above count only the moves it is
  -- for (`source`, 'list' or 'email', is the analytics' and the reader's); a display name here would be the leak the
  -- constraint on this table refuses anyway.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_reattached', 'circle', target_circle,
          jsonb_build_object('from_user_id', target, 'to_user_id', caller, 'source', entry_source,
                             'capped', not established));

  -- The owner's "Priya rejoined from a new device" (spec §5.1) starts here.
  -- No name: the notification pipeline reads the roster for that.
  perform jobs.emit('circles.member_reattached', 'circle', target_circle,
    jsonb_build_object('circle_id', target_circle, 'user_id', caller, 'source', entry_source));

  return chosen;
end;
$$;

comment on function public.reattach_member(uuid, uuid, bytea) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list or an emailed re-entry token (ADR 0006). Only in an active circle; a per-circle hourly limit on the list path; at most three counted moves per membership per seven days, and a move made with a re-entry token for an address that was on the place before the week''s first counted move is never refused by that cap (ADR 0048); never onto a saved-place member.';

revoke all on function public.reattach_member(uuid, uuid, bytea) from public;
revoke all on function public.reattach_member(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.reattach_member(uuid, uuid, bytea) to authenticated;

-- END GENERATED: function definitions
