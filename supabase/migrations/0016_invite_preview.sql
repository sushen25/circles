-- ---------------------------------------------------------------------------
-- 0016 — the Join page's preview (S1-24).
--
-- One new function, `public.invite_preview`: what somebody holding an invite
-- link sees before they join. Its reasoning is in
-- `supabase/sql/functions/public/invite_preview.sql`, which is the definition
-- (ADR 0015); this migration only carries it.
--
-- A new migration rather than a regenerated `0015`, because `0015` has shipped
-- to `circles-prod`.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

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
-- is not a way in — `redeem-invite` takes the secret, not the digest — so
-- whoever sees one can learn only what this returns. A 256-bit secret is not a
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
  select c.name into circle_name
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.short_code = p_code and c.status = 'active';

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

  -- Three per membership per seven days (ADR 0006). Counting is not a simple
  -- `where user_id = target`: every reattachment *changes* the membership's
  -- user id, so the previous ones are recorded against identities this one has
  -- never seen. The audit rows form a chain — each names the identity it moved
  -- from and the one it moved to — and the membership's history is the walk
  -- backwards along it.
  --
  -- `union`, not `union all`, and the row's own id in the result — because the
  -- chain can be a *cycle*. A membership moves A→B, and later, from the session
  -- on device A that is still valid, B→A. The history then loops A→B→A→B, and
  -- `union all` follows it until the statement is cancelled or the server runs
  -- out of memory. `union` discards a row already in the result, so revisiting
  -- the same audit row ends the recursion; carrying the id keeps two genuinely
  -- separate moves between the same pair of identities counted as two.
  with recursive chain (id, from_id, to_id) as (
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id'
    from private.audit_log a
    where a.action = 'circles.member_reattached'
      and a.resource_id = target_circle
      and a.occurred_at > now() - interval '7 days'
      and a.metadata ->> 'to_user_id' = target::text
    union
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id'
    from private.audit_log a
    join chain on a.metadata ->> 'to_user_id' = chain.from_id
    where a.action = 'circles.member_reattached'
      and a.resource_id = target_circle
      and a.occurred_at > now() - interval '7 days'
  )
  select count(*) into moves from chain;

  if moves >= 3 then
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
  -- walkable; a display name here would be the leak the constraint on this
  -- table refuses anyway.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_reattached', 'circle', target_circle,
          jsonb_build_object('from_user_id', target, 'to_user_id', caller));

  -- The owner's "Priya rejoined from a new device" (spec §5.1) starts here.
  -- No name: the notification pipeline reads the roster for that.
  perform jobs.emit('circles.member_reattached', 'circle', target_circle,
    jsonb_build_object('circle_id', target_circle, 'user_id', caller, 'source', entry_source));

  return chosen;
end;
$$;

comment on function public.reattach_member(uuid, uuid, bytea) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list or an emailed re-entry token (ADR 0006). At most three per membership per seven days; never onto a saved-place member.';

revoke all on function public.reattach_member(uuid, uuid, bytea) from public;
revoke all on function public.reattach_member(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.reattach_member(uuid, uuid, bytea) to authenticated;

-- END GENERATED: function definitions
