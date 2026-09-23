-- ---------------------------------------------------------------------------
-- 0021 — running a circle (S1-23).
--
-- The owner's half of circle settings, and one switch for everybody:
--
--   * `public.remove_member` — the owner removes somebody. What follows is
--     `on_member_removed`'s, as it has been since 0011; this is the *whether*.
--   * `public.live_invite` — which invite is live, for its owner, so that
--     `get-invite-link` can show the link again (ADR 00XX).
--   * `public.issue_invite` and `public.create_circle` take the invite's id,
--     because the secret is now derived from it by the Edge Functions with a
--     key the database never holds. Only the digest is stored, as before (§14).
--     `create_circle` also takes "Where, roughly", which CreateCircle asks for.
--   * `circle_members.muted_nudges` — "Nudges to plan the next one" on
--     notification settings, stored on the membership like the other two
--     switches. Nothing sends a nudge yet (S2-04); the choice is kept so that
--     the day something does, it already knows who said no.
--
-- A new migration rather than a regenerated `0020`, because `0020` has
-- shipped; `MIGRATION` in `scripts/gen-sql-functions.mjs` now points here.
-- ---------------------------------------------------------------------------

-- Two signatures change. `create or replace` with a longer argument list makes
-- an overload rather than a replacement, and an overload with defaults makes
-- every existing call ambiguous — so the old ones go first, and the generated
-- block below brings the new ones in.
drop function if exists public.issue_invite(uuid, bytea);
drop function if exists public.create_circle(text, text, text, text, text, bytea);

alter table public.circle_members
  add column muted_nudges boolean not null default false;

comment on column public.circle_members.muted_nudges is
  'This member does not want the cadence nudge for this circle ("Nudges to plan the next one"). Read by the nudge recipient rule once cadence nudges are sent (S2-04).';

-- "Where, roughly" is typed by a person now (CreateCircle, circle settings), so
-- it gets the bound every other typed field has. Nothing wrote it before.
alter table public.circles
  add constraint circles_default_area_length
  check (default_area is null or char_length(default_area) between 1 and 60);

-- The member's own switch, like `muted_quiet_asks` and `muted_all`:
-- `circle_members_update_own` limits the row to their own and only while they
-- are still in the circle; this limits the column.
grant update (muted_nudges) on public.circle_members to authenticated;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/create_circle.sql
-- ---------------------------------------------------------------------------
-- create_circle
--
-- The only way a circle comes into existence. A definer function rather than an
-- insert policy, because a circle and its owner's membership have to appear
-- together — an insert policy would leave a window in which a circle exists
-- with no members and therefore no one who can see it.
--
-- The invite link is here for the same reason, one step further out. Spec §5.1
-- makes the circle and the link one step of one flow, and `create-circle` used
-- to make them with two RPCs: a failure between them left a circle nobody could
-- be invited to, a `circles.circle_created` event about it, and a person looking
-- at an error message. Given a digest, the link is issued in this transaction,
-- so the answer to "did that work?" is the same answer for both.
-- ---------------------------------------------------------------------------

create or replace function public.create_circle(
  name text,
  color text,
  time_zone text,
  -- Required, and therefore ahead of the optional cadence. §9.1 has every
  -- mutation idempotent on a client-supplied key, and an optional one is a key
  -- nobody sends: the retry it guards against is the one where the client never
  -- saw a response and cannot tell a timeout from a failure.
  idempotency_key text,
  cadence text default 'none',
  -- SHA-256 of the invite secret, which the server never sees (§14). Optional
  -- because a circle is a circle without a link — fixtures and tests make them
  -- that way — and passed by `create-circle` always, because the flow it serves
  -- promises both.
  invite_secret_hash bytea default null,
  -- The invite's id, when the secret was derived from it (ADR 00XX): what lets
  -- the owner be shown this link again. Absent, the link is issued with an id
  -- of its own and can only ever be reset.
  invite_id uuid default null,
  -- "Where, roughly" on CreateCircle (S1-23): a loose area, optional. Blank is
  -- no answer, not an empty place.
  default_area text default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The `ShortCode` contract's alphabet (`packages/contracts/src/ids.ts`).
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  caller uuid := (select auth.uid());
  caller_name text;
  created public.circles;
  code text;
  i integer;
begin
  if not public.auth_is_permanent() then
    -- The organiser gate (ADR 0004). Worded as a practical need by the client;
    -- here it is simply a refusal.
    raise exception 'creating a circle needs a saved place'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(create_circle.idempotency_key), '') = '' then
    raise exception 'create_circle needs an idempotency key'
      using errcode = 'null_value_not_allowed';
  end if;

  -- A retry returns what the first attempt made. Creating a circle is the one
  -- mutation where a lost response is expensive: the client cannot tell a
  -- timeout from a failure, and trying again would leave the person with two
  -- circles and no way to tell which one they gave the link out for.
  select * into created
  from public.circles c
  where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
  if found then
    return created;
  end if;

  select p.display_name into caller_name from public.profiles p where p.user_id = caller;
  if caller_name is null then
    raise exception 'no profile for %', caller using errcode = 'foreign_key_violation';
  end if;

  -- Ten characters from the `ShortCode` alphabet — no `0`/`o`, no `1`/`l`/`i`,
  -- because a short code is read aloud and retyped. Not a secret and not
  -- required to be unguessable: the invite secret is the capability, and it
  -- never reaches a server (§14). The loop retries on collision rather than
  -- hoping there is none.
  loop
    code := '';
    for i in 1..10 loop
      code := code || substr(
        alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)),
        1
      );
    end loop;
    exit when not exists (select 1 from public.circles c where c.short_code = code);
  end loop;

  insert into public.circles
    (owner_user_id, name, color, time_zone, cadence, short_code, creation_key, default_area)
  values (caller, create_circle.name, create_circle.color, create_circle.time_zone,
          create_circle.cadence, code, create_circle.idempotency_key,
          nullif(btrim(create_circle.default_area), ''))
  returning * into created;

  insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
  values (created.id, caller, caller_name, 'owner');

  -- The link, in the same transaction, through the function that owns what
  -- issuing one means: the audit row, the revocation of any earlier link, and
  -- the rule that the first link announces nothing because the circle's own
  -- creation already did. It checks that the caller owns the circle, which they
  -- do — they are two statements away from having made it.
  if create_circle.invite_secret_hash is not null then
    perform public.issue_invite(
      created.id, create_circle.invite_secret_hash, create_circle.invite_id
    );
  end if;

  -- `circles.circle_created` and `circles.member_joined` are written to
  -- `jobs.outbox` by the row triggers in 0006, in this transaction — on the
  -- rows rather than here, so that every writer of a circle or a membership
  -- announces it, not only this function.

  return created;

exception
  when unique_violation then
    -- Two identical requests in flight at once: the index caught the second, and
    -- the row the first one wrote is the answer.
    select * into created
    from public.circles c
    where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
    if found then
      return created;
    end if;
    raise;
end;
$$;

comment on function public.create_circle(text, text, text, text, text, bytea, uuid, text) is
  'Creates a circle, its owner membership and — given a digest — its invite link, in one transaction. Requires a permanent identity (ADR 0004).';

revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text) from public;
revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text) from anon, authenticated;
grant execute on function public.create_circle(text, text, text, text, text, bytea, uuid, text) to authenticated;

-- supabase/sql/functions/public/issue_invite.sql
-- ---------------------------------------------------------------------------
-- The circle's one live invite link.
--
-- "The owner shares one revocable circle link" and "can remove a member and
-- reset the link without disturbing existing members" (spec §5.2). Issuing and
-- resetting are the same operation — a new secret, and every earlier one dead —
-- so they are one function. `create-circle` calls it for the first link; the
-- reset endpoint (S1-23) will call it for every later one.
--
-- **The secret never arrives.** The Edge Function generates 32 random bytes,
-- hashes them, and passes the digest; the readable form goes back to the client
-- once, in the response, to build `/join#<secret>`. §14: the secret lives in the
-- URL fragment, which no server sees, and only its SHA-256 is stored.
--
-- Revoking first, in the same statement, is what makes "reset" mean something:
-- two live invites would be two capabilities, and rotating would stop
-- invalidating anything.
--
-- **The invite's id may come from the caller** (ADR 00XX). The Edge Functions
-- derive the secret from the id with a key only they hold, so that the owner
-- can be shown the link again (`get-invite-link`) while the database still
-- stores nothing but a digest. That needs the id before the row exists. An id
-- the caller chooses buys them nothing: the secret is the key's to derive, and
-- a digest of anything else is simply a link `get-invite-link` cannot show.
-- ---------------------------------------------------------------------------

create or replace function public.issue_invite(
  p_circle_id uuid,
  p_secret_hash bytea,
  p_invite_id uuid default null
)
returns public.circle_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  issued public.circle_invites;
  revoked integer;
begin
  if caller is null then
    raise exception 'issue_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- The owner's, not any member's. Handing out the way in is the one circle
  -- decision spec §5.2 gives to the owner alone.
  if not exists (
    select 1 from public.circles c where c.id = p_circle_id and c.owner_user_id = caller
  ) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  update public.circle_invites i
  set revoked_at = now()
  where i.circle_id = p_circle_id and i.revoked_at is null;
  get diagnostics revoked = row_count;

  insert into public.circle_invites (id, circle_id, secret_hash, created_by)
  values (coalesce(p_invite_id, gen_random_uuid()), p_circle_id, p_secret_hash, caller)
  returning * into issued;

  -- Rotation is a fact the owner may need to explain later ("the old link
  -- stopped working on Tuesday"), and the count of how often links leak is
  -- worth having. Ids only.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.invite_issued', 'circle', p_circle_id,
          jsonb_build_object('invite_id', issued.id));

  -- Only when something was actually revoked. The first link a circle has is
  -- part of the circle being created, and `circles.circle_created` already says
  -- that; `circles.invite_rotated` means "the one you were given has stopped
  -- working", which is a thing to tell people and is not true here.
  if revoked > 0 then
    perform jobs.emit('circles.invite_rotated', 'circle', p_circle_id,
      jsonb_build_object('circle_id', p_circle_id));
  end if;

  return issued;
end;
$$;

comment on function public.issue_invite(uuid, bytea, uuid) is
  'Issues the circle''s invite from a digest of a secret the server never sees, revoking any earlier one. The owner''s alone; resetting the link is the same call (spec §5.2).';

revoke all on function public.issue_invite(uuid, bytea, uuid) from public;
revoke all on function public.issue_invite(uuid, bytea, uuid) from anon, authenticated;
grant execute on function public.issue_invite(uuid, bytea, uuid) to authenticated;

-- supabase/sql/functions/public/live_invite.sql
-- ---------------------------------------------------------------------------
-- The circle's live invite, as its owner may know it (S1-23, ADR 00XX).
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
-- The digest reaches its owner. That is not the secret, and nothing accepts it
-- in place of one: `redeem_invite` and `invite_preview` hash what they are
-- given, so a digest presented as a secret is a digest of a digest. It is
-- returned because comparing it here instead would mean the Edge Function
-- sending the derived secret's digest back in, which is the same comparison
-- with one more round trip.
--
-- No row when the circle has no live invite: a circle made without one (the
-- fixtures do that) has nothing to show until the owner resets it.
-- ---------------------------------------------------------------------------

create or replace function public.live_invite(p_circle_id uuid)
returns table (invite_id uuid, secret_hash bytea)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'live_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- `auth_is_owner` asks for an *active* owner: an owner who has left owns
  -- nothing, and an id that is not a circle is simply not theirs.
  if not public.auth_is_owner(p_circle_id) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.secret_hash
    from public.circle_invites i
    where i.circle_id = p_circle_id and i.revoked_at is null;
end;
$$;

comment on function public.live_invite(uuid) is
  'The id and digest of a circle''s live invite, for its owner, so get-invite-link can re-derive the secret (ADR 00XX). Never the secret: the database does not have it.';

revoke all on function public.live_invite(uuid) from public;
revoke all on function public.live_invite(uuid) from anon, authenticated;
grant execute on function public.live_invite(uuid) to authenticated;

-- supabase/sql/functions/public/remove_member.sql
-- ---------------------------------------------------------------------------
-- Removing somebody from a circle (spec §5.2, §4.5; S1-23).
--
-- "The owner can remove a member … without disturbing existing members." The
-- owner's alone, and never the owner themselves: a circle is owned by one of
-- its members (`enforce_owner_stays_member`), and handing it on is its own
-- operation.
--
-- This function decides *whether*; `public.on_member_removed` decides *what
-- follows*, and it is a trigger on the row so that every writer of
-- `status = 'removed'` gets the same consequences: their answers to plans still
-- asking go, they leave those plans' participant lists, a `ready` plan they
-- helped make ready goes back to collecting, and a meetup still ahead stops
-- counting them as going. `jobs.on_member_changed` emits
-- `circles.member_removed`. Access ends with the statement: every policy is
-- written against `auth_is_member`, which reads `status`.
--
-- What it returns is the other half of "excluded from the next recalculation":
-- the plans whose candidate sets the removal has made stale. The trigger bumps
-- their input version, so no set computed with the departed member can be
-- confirmed; `remove-member` then runs the engine on each in the same request
-- (ADR 0018), so the organiser sees the options without them straight away.
--
-- The circle row is locked first — the order `create_plan` and the trigger lock
-- in — so a removal racing a new plan cannot leave the member on its roster.
-- ---------------------------------------------------------------------------

create or replace function public.remove_member(p_circle_id uuid, p_user_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_status text;
  stale uuid[];
begin
  if caller is null then
    raise exception 'remove_member requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.circles c where c.id = p_circle_id for update;

  if not public.auth_is_owner(p_circle_id) then
    raise exception 'not_the_owner' using errcode = 'insufficient_privilege';
  end if;

  if p_user_id = caller then
    raise exception 'cannot_remove_owner' using errcode = 'check_violation';
  end if;

  select m.status into target_status
  from public.circle_members m
  where m.circle_id = p_circle_id and m.user_id = p_user_id
  for update;

  -- Somebody already removed, and somebody never in it, are the same answer:
  -- there is nobody active by that id to remove.
  if target_status is distinct from 'active' then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  update public.circle_members m
  set status = 'removed', updated_at = now()
  where m.circle_id = p_circle_id and m.user_id = p_user_id;

  -- Who removed whom is a fact the owner may need later ("why can't Sam see
  -- the plan?"). Ids only, like every row here.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_removed', 'circle', p_circle_id,
          jsonb_build_object('user_id', p_user_id));

  select coalesce(array_agg(p.id order by p.created_at), '{}'::uuid[]) into stale
  from public.plans p
  where p.circle_id = p_circle_id and p.state in ('collecting', 'ready');

  return stale;
end;
$$;

comment on function public.remove_member(uuid, uuid) is
  'Removes an active member from a circle, as its owner; returns the plans whose candidates must be recalculated without them (spec §5.2, §4.5).';

revoke all on function public.remove_member(uuid, uuid) from public;
revoke all on function public.remove_member(uuid, uuid) from anon, authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- END GENERATED: function definitions
