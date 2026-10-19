-- 0070_invite_digests_are_hmac
--
-- (Numbered 0070: open pull requests hold 0068 and 0069.)
--
-- SUS-214, ADR 0081 (amends ADR 0028). An invite secret and an emailed re-entry
-- token are stored as a digest. Until now it was a plain SHA-256, which anybody
-- holding a copy of `circle_invites` or `email_action_tokens` (a backup, an
-- export, a read-only SQL user) can recompute for a guess, and, together with
-- the service role's key, use. From now on a *new* digest is an HMAC-SHA-256
-- under `INVITE_DIGEST_KEY`, a secret held by the Edge Functions and never by
-- the database, so a copy of the tables cannot reproduce one.
--
-- Rows already stored stay as they are, and keep working, because the column
-- below says which kind each is:
--
--   * `circle_invites.digest_kind`: existing rows are `sha256`. Invites have no
--     expiry, so a `sha256` invite lasts until its owner resets the link or an
--     operator reissues it.
--   * `private.email_action_tokens.digest_kind`: right for the verification,
--     preferences and stop tokens, whose digests this does not change. The
--     re-entry tokens already issued are `sha256` and expire within seven days.
--
-- The functions that store a digest (`issue_invite`, `create_circle`,
-- `issue_reentry_token`) take a `p_digest_kind`, `hmac` from the new Edge
-- Functions, defaulting to `sha256` so that the old ones, which run between this
-- migration and the functions deploy, label what they store truthfully.
--
-- The functions that look a digest up take the HMAC and, beside it, the legacy
-- SHA-256 of the same secret. The legacy one finds only a `sha256` row and the
-- HMAC only an `hmac` row, so neither can stand in for the other. Dropping the
-- legacy path is a later migration (ADR 0081 says when).
--
-- `invite_preview` was `anon`'s, keyed by a digest the browser computed. The
-- browser cannot hold the key, so it is now the service role's and the new
-- `invite-preview` Edge Function hashes the secret. `live_invite` also returns
-- the kind, so `get-invite-link` can show an old link and a new one.

alter table public.circle_invites
  add column digest_kind text not null default 'sha256',
  add constraint circle_invites_digest_kind check (digest_kind in ('sha256', 'hmac'));

comment on column public.circle_invites.digest_kind is
  'How secret_hash was made: sha256 (a plain digest, before ADR 0081) or hmac (under INVITE_DIGEST_KEY, which the database does not hold). Said by whoever stores it; the default is the label an older function is telling the truth with.';

alter table private.email_action_tokens
  add column digest_kind text not null default 'sha256',
  add constraint email_action_tokens_digest_kind check (digest_kind in ('sha256', 'hmac'));

comment on column private.email_action_tokens.digest_kind is
  'How token_hash was made: sha256, or hmac (a re-entry token issued after ADR 0081, under INVITE_DIGEST_KEY, which the database does not hold).';

-- Why the default stays `sha256`: the migration is pushed before the functions
-- are deployed, and until they are the old ones keep storing a plain SHA-256
-- through these same functions. Defaulting to `hmac` would label those rows
-- wrongly and the new lookups would never find them. The new functions say
-- `hmac` explicitly.
drop function public.issue_invite(uuid, bytea, uuid);
drop function public.create_circle(text, text, text, text, text, bytea, uuid, text);
drop function public.issue_reentry_token(uuid, uuid, bytea);
drop function public.redeem_invite(uuid, bytea, text);
drop function public.reattach_with_token(uuid, bytea);
drop function private.reattach_member_core(uuid, uuid, uuid, bytea);
drop function public.invite_preview(bytea);
drop function public.live_invite(uuid, uuid);

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
-- **Two digests, one token** (SUS-214, ADR 0081). A token made after the change
-- is stored as an HMAC under a key the database never holds (`p_reentry_token_hash`,
-- kind `hmac`); one made before it is a plain SHA-256 (`p_legacy_token_hash`,
-- kind `sha256`). the lookup takes whichever the stored row's kind
-- says it is, and never the other: an HMAC row is not found by a SHA-256 and the
-- reverse. The legacy digest goes when the last such token has expired.
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
  p_reentry_token_hash bytea,
  p_legacy_token_hash bytea
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
      where (
        (t.token_hash = p_reentry_token_hash and t.digest_kind = 'hmac')
        or (p_legacy_token_hash is not null and t.token_hash = p_legacy_token_hash
            and t.digest_kind = 'sha256')
      )
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
    where (
        (t.token_hash = p_reentry_token_hash and t.digest_kind = 'hmac')
        or (p_legacy_token_hash is not null and t.token_hash = p_legacy_token_hash
            and t.digest_kind = 'sha256')
      )
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
        where (
        (t.token_hash = p_reentry_token_hash and t.digest_kind = 'hmac')
        or (p_legacy_token_hash is not null and t.token_hash = p_legacy_token_hash
            and t.digest_kind = 'sha256')
      )
          and t.purpose = 'reentry' and p.is_permanent
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

  -- No cap on how often a membership moves (ADR 0078, which removed ADR 0006's
  -- three-a-week). A guest who opens the link in a new browser is a new session
  -- every time, and they may pick their own name as often as that happens. What
  -- bounds a stranger doing the same is the hourly throttle per circle
  -- (`take_rate_token` above, twenty an hour) and "rejoined from a new
  -- device" on circle home.

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

comment on function private.reattach_member_core(uuid, uuid, uuid, bytea, bytea) is
  'Moves a guest membership and everything scoped to it onto p_caller, from the Continue-as list (a circle and a member) or an emailed re-entry token digest (ADR 0006): only in an active circle, and on the list path only while one of its plans is live (ADR 0059); a per-circle hourly limit on the list path; no cap on how often one membership moves (ADR 0078); never onto a saved-place member, but a valid token takes a place back from a saved account whose own address is not the link''s (ADR 0049, decision 6). Called only by reattach_member and reattach_with_token, which say who p_caller is.';

revoke all on function private.reattach_member_core(uuid, uuid, uuid, bytea, bytea) from public;
revoke all on function private.reattach_member_core(uuid, uuid, uuid, bytea, bytea) from anon, authenticated;

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
  -- The invite's id, when the secret was derived from it (ADR 0028): what lets
  -- the owner be shown this link again. Absent, the link is issued with an id
  -- of its own and can only ever be reset.
  invite_id uuid default null,
  -- "Where, roughly" on CreateCircle (S1-23): a loose area, optional. Blank is
  -- no answer, not an empty place.
  default_area text default null,
  -- What `invite_secret_hash` is: `hmac` from the Edge Function that holds the
  -- digest key, `sha256` from one that does not (ADR 0081). Passed to `issue_invite`.
  digest_kind text default 'sha256'
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
  pick integer;
begin
  if not public.auth_is_permanent() then
    -- The organiser gate (ADR 0004). Worded as a practical need by the client;
    -- here it is simply a refusal.
    raise exception 'creating a circle needs a saved place'
      using errcode = 'insufficient_privilege';
  end if;

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'create_circle_sql', extensions.digest(caller::text, 'sha256'), 60, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
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
      -- Rejection sampling: a byte is 0..255 and 256 is not a multiple of 31,
      -- so `% 31` would favour the first eight letters. Bytes from the last,
      -- partial run are thrown away and redrawn (about 3% of them).
      loop
        pick := get_byte(extensions.gen_random_bytes(1), 0);
        exit when pick < (256 / length(alphabet)) * length(alphabet);
      end loop;
      code := code || substr(alphabet, 1 + (pick % length(alphabet)), 1);
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
      created.id, create_circle.invite_secret_hash, create_circle.invite_id,
      create_circle.digest_kind
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

comment on function public.create_circle(text, text, text, text, text, bytea, uuid, text, text) is
  'Creates a circle, its owner membership and — given a digest — its invite link, in one transaction. Requires a permanent identity (ADR 0004).';

revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text, text) from public;
revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text, text) from anon, authenticated;
grant execute on function public.create_circle(text, text, text, text, text, bytea, uuid, text, text) to authenticated;

-- supabase/sql/functions/public/invite_preview.sql
-- ---------------------------------------------------------------------------
-- What the Join page shows before anybody has joined (spec §5.1, S1-24).
--
-- "Before any prompt the page shows: circle name, inviter's name, who is in so
-- far." A visitor holding an invite link has no session and no membership, so
-- RLS shows them nothing — and asking them to sign in, even anonymously, before
-- they have seen what they are being asked to join is the prompt §5.1 says must
-- not come first. So the page asks for it without a session.
--
-- **What authorises it is the secret.** Keyed by a digest of it, as
-- `redeem_invite` is, so the capability itself never becomes a statement
-- parameter (§14).
--
-- **The service role's, since SUS-214 (ADR 0081).** The digest is an HMAC under
-- a key only the Edge Functions hold, so a browser cannot compute it and the
-- `anon` role cannot be given this. The Join page asks the `invite-preview`
-- Edge Function, which needs no session either: it takes the secret, hashes it
-- and calls this. The Edge Function carries a per-address limit, because it,
-- unlike a stored digest, can be asked by anybody. `p_legacy_hash` is the plain
-- SHA-256 of the same secret, for a link made before that change; it finds only
-- an invite stored as `sha256` (ADR 0081).
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

create or replace function public.invite_preview(p_secret_hash bytea, p_legacy_hash bytea default null)
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
  where i.revoked_at is null
    and (
      (i.secret_hash = p_secret_hash and i.digest_kind = 'hmac')
      or (p_legacy_hash is not null and i.secret_hash = p_legacy_hash
          and i.digest_kind = 'sha256')
    )
    and c.status = 'active';
$$;

comment on function public.invite_preview(bytea, bytea) is
  'The Join page before joining: circle name, inviter name and one initial per member, by invite digest. No row for a revoked or unknown invite or an archived circle. Service role only: the invite-preview Edge Function hashes the secret under a key the database does not hold (ADR 0081).';

revoke all on function public.invite_preview(bytea, bytea) from public;
revoke all on function public.invite_preview(bytea, bytea) from anon, authenticated;
grant execute on function public.invite_preview(bytea, bytea) to service_role;

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
-- **The digest is an HMAC under a key only the Edge Functions hold** (SUS-214,
-- ADR 0081). The database cannot tell an HMAC from any other 32 bytes, so the
-- kind is the caller's to say: `p_digest_kind` is `hmac` from the Edge Functions
-- that hold the key. It defaults to `sha256`, the label an older function that
-- sends a plain SHA-256 is telling the truth with, so a deploy that migrates the
-- database before it replaces the functions leaves nothing mislabelled.
--
-- **The invite's id may come from the caller** (ADR 0028). The Edge Functions
-- derive the secret from the id with a key only they hold, so that the owner
-- can be shown the link again (`get-invite-link`) while the database still
-- stores nothing but a digest. That needs the id before the row exists. An id
-- the caller chooses buys them nothing: the secret is the key's to derive, and
-- a digest of anything else is simply a link `get-invite-link` cannot show.
-- ---------------------------------------------------------------------------

create or replace function public.issue_invite(
  p_circle_id uuid,
  p_secret_hash bytea,
  p_invite_id uuid default null,
  p_digest_kind text default 'sha256'
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

  -- A limit that holds when this is called directly over RPC, where the Edge
  -- Function's own never runs. Keyed on the caller (and, below, on the caller's
  -- own plan or circle): a bucket named only by an id the caller supplies would
  -- let anybody spend somebody else's allowance by naming their resource.
  -- Sized far above the Edge limit, so that one is the limit a person meets.

  if not public.take_rate_token(
    'issue_invite_sql', extensions.digest(caller::text, 'sha256'), 120, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
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

  insert into public.circle_invites (id, circle_id, secret_hash, digest_kind, created_by)
  values (
    coalesce(p_invite_id, gen_random_uuid()), p_circle_id, p_secret_hash, p_digest_kind, caller
  )
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

comment on function public.issue_invite(uuid, bytea, uuid, text) is
  'Issues the circle''s invite from a digest of a secret the server never sees, revoking any earlier one. The owner''s alone; resetting the link is the same call (spec §5.2).';

revoke all on function public.issue_invite(uuid, bytea, uuid, text) from public;
revoke all on function public.issue_invite(uuid, bytea, uuid, text) from anon, authenticated;
grant execute on function public.issue_invite(uuid, bytea, uuid, text) to authenticated;

-- supabase/sql/functions/public/issue_reentry_token.sql
-- ---------------------------------------------------------------------------
-- The single-use way back into a circle, for a guest with no session.
--
-- Every event email carries one (spec §5.8, §5.11): "a guest returns with no
-- session" is the most common real thing that happens (§9), and without this
-- their only way back is a link somebody else has to resend. Seven days,
-- single-use, and consumed by `reattach-member` (S1-13), which moves the
-- membership onto whatever identity the browser has now.
--
-- **Null for a saved-place identity**, because that is not a fault. Every event
-- email carries a re-entry link and permanent members get event email too; the
-- template simply leaves the link out for somebody who can sign in. Reaching
-- the table's own guard instead — `enforce_reentry_for_guests`, which raises
-- `check_violation` — turned an ordinary rendering decision into a SQLSTATE
-- nothing can translate and a 500 for the reader. The trigger stays: it is the
-- rule, and this is the answer the one caller needs. A sign-in bypass is still
-- impossible, now twice over.
--
-- **For the contact the letter is going to** (S1-19). It used to take the
-- user and hang the token on their most recently verified contact, which is
-- not necessarily the address the email is for: somebody with two verified
-- addresses who later removed the first had the cascade take the re-entry
-- links out of letters sent to the second. The dispatcher knows exactly which
-- contact it is writing to — the job names it — so it says so, and the user is
-- the contact's owner.
--
-- **The digest is an HMAC under a key only the Edge Function holds** (SUS-214,
-- ADR 0081), and the caller says so with `p_digest_kind = 'hmac'`; the default,
-- `sha256`, is the truth for an older function that sends a plain SHA-256, so a
-- deploy that migrates before it replaces the functions mislabels nothing. Every
-- token made before the change is `sha256` and opens its link until it expires.
--
-- Service role only. It mints nothing itself — the Edge Function generates the
-- token and passes the digest, so the readable form is never a statement
-- parameter and never reaches a query log (§14).
-- ---------------------------------------------------------------------------

create or replace function public.issue_reentry_token(
  p_circle_id uuid,
  p_contact_id uuid,
  p_token_hash bytea,
  p_digest_kind text default 'sha256'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact private.email_contacts;
  token_id uuid;
begin
  -- A verified one: a re-entry link travels in an email, and an email goes
  -- only to an address that proved itself.
  select * into contact from private.email_contacts c where c.id = p_contact_id;

  if not found or contact.status <> 'verified' then
    raise exception 'no_verified_contact' using errcode = 'P0001';
  end if;

  -- Somebody who signs in needs no way back, so there is nothing to issue and
  -- nothing has gone wrong. Checked before the membership, because a permanent
  -- identity's membership is beside the point.
  if exists (
    select 1 from public.profiles pr where pr.user_id = contact.user_id and pr.is_permanent
  ) then
    return null;
  end if;

  -- The membership has to be one. A token for a circle this person is not in
  -- would be a link back into somebody else's circle, and the foreign key that
  -- would have caught it raises a SQLSTATE nothing can translate — a 500 for an
  -- ordinary mistake.
  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle_id and m.user_id = contact.user_id and m.status = 'active'
  ) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  insert into private.email_action_tokens (
    contact_id, purpose, token_hash, digest_kind, expires_at, membership_circle_id,
    membership_user_id, minted_for_user_id
  )
  values (
    contact.id, 'reentry', p_token_hash, p_digest_kind, now() + interval '7 days', p_circle_id,
    contact.user_id, contact.user_id
  )
  returning id into token_id;

  return token_id;
end;
$$;

comment on function public.issue_reentry_token(uuid, uuid, bytea, text) is
  'Stores the digest of a seven-day single-use re-entry token for the guest membership of one verified contact''s owner, and returns null for a saved-place identity, which needs no link. The token itself is minted in the Edge Function and never reaches the database. Service role only.';

revoke all on function public.issue_reentry_token(uuid, uuid, bytea, text) from public;
revoke all on function public.issue_reentry_token(uuid, uuid, bytea, text) from anon, authenticated;
grant execute on function public.issue_reentry_token(uuid, uuid, bytea, text) to service_role;

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
-- **Which kind of digest it is** (SUS-214, ADR 0081): an invite made after the
-- change is an HMAC under `INVITE_DIGEST_KEY`, one made before is a plain
-- SHA-256, and `get-invite-link` compares the one that matches.
--
-- No row when the circle has no live invite: a circle made without one (the
-- fixtures do that) has nothing to show until the owner resets it.
-- ---------------------------------------------------------------------------

create or replace function public.live_invite(p_circle_id uuid, p_user_id uuid)
returns table (invite_id uuid, secret_hash bytea, digest_kind text)
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
    select i.id, i.secret_hash, i.digest_kind
    from public.circle_invites i
    where i.circle_id = p_circle_id and i.revoked_at is null;
end;
$$;

comment on function public.live_invite(uuid, uuid) is
  'The id, digest and digest kind of a circle''s live invite, if p_user_id owns the circle, so get-invite-link can re-derive the secret (ADR 0028). Never the secret: the database does not have it. Service role only: the digest does not reach a client (SUS-114).';

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
  return private.reattach_member_core((select auth.uid()), p_circle_id, p_target_user_id, null, null);
end;
$$;

comment on function public.reattach_member(uuid, uuid) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list (ADR 0006). The emailed re-entry link is reattach_with_token, the service role''s. Only in an active circle and only while one of its plans is live (ADR 0059); a per-circle hourly limit; no cap on how often one membership moves (ADR 0078); never onto a saved-place member.';

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
-- **The service role's, and nobody else's.** The table keeps only a digest of
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
-- **The digest is an HMAC under a key only the Edge Function holds** (SUS-214,
-- ADR 0081): the table cannot be turned into a digest by anybody who has the
-- table alone. `p_legacy_token_hash` is the plain SHA-256 of the same token, for
-- a link emailed before that change; it finds only a row stored as `sha256`
-- (`email_action_tokens.digest_kind`), and no row made since is stored that way.
-- A re-entry link lasts seven days, so the legacy digest has no use after the
-- seventh day and is removed then.
--
-- `p_user_id` is who is coming back. It can be trusted because only the service
-- role can say it, and the Edge Function takes it from the verified JWT, never
-- from the body. The JWT is not read here: the service role's is not the
-- person's, so the stale-token check in the core relies on the two database
-- records alone, which are current.
-- ---------------------------------------------------------------------------

create or replace function public.reattach_with_token(
  p_user_id uuid,
  p_reentry_token_hash bytea,
  p_legacy_token_hash bytea default null
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

  return private.reattach_member_core(
    p_user_id, null, null, p_reentry_token_hash, p_legacy_token_hash
  );
end;
$$;

comment on function public.reattach_with_token(uuid, bytea, bytea) is
  'Moves a guest membership onto p_user_id from an emailed re-entry token digest (ADR 0006, ADR 0049). Service role only: the digest is stored, so it must not be a way in by itself, and the reattach-member Edge Function that hashes the token passes the caller it verified. The digest is an HMAC under a key the database does not hold; p_legacy_token_hash finds only a token stored before that (ADR 0081).';

revoke all on function public.reattach_with_token(uuid, bytea, bytea) from public;
revoke all on function public.reattach_with_token(uuid, bytea, bytea) from anon, authenticated;
grant execute on function public.reattach_with_token(uuid, bytea, bytea) to service_role;

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
-- fragment and passes the digest, so the capability itself is never a statement
-- parameter and cannot reach a query log (§14: tokens are "never logged"). The
-- digest finds the invite; the row it finds is the authority.
--
-- **The digest is an HMAC under a key only the Edge Function holds** (SUS-214,
-- ADR 0081), so a copy of `circle_invites` is not enough to compute one.
-- `p_legacy_hash` is the plain SHA-256 of the same secret, offered so that a
-- link made before that change still opens its circle: it finds only a row
-- stored as `sha256` (`circle_invites.digest_kind`), and every invite made since
-- is stored as `hmac`. The legacy path is removed once ADR 0081's condition is
-- met.
--
-- **The service role's, and nobody else's (SUS-114).** The table keeps only a
-- digest of the secret, so if that digest were enough to call this, a copy of
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
  p_display_name text,
  p_legacy_hash bytea default null
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
  where i.revoked_at is null
    and (
      (i.secret_hash = p_secret_hash and i.digest_kind = 'hmac')
      or (p_legacy_hash is not null and i.secret_hash = p_legacy_hash
          and i.digest_kind = 'sha256')
    );

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

comment on function public.redeem_invite(uuid, bytea, text, bytea) is
  'Joins p_user_id to the circle behind an invite digest. Idempotent on an existing active membership; raises invite_inactive, duplicate_name or circle_full. Service role only: the digest is stored, so it must not be a way in by itself, and the redeem-invite Edge Function that hashes the secret passes the caller it verified (SUS-114). The digest is an HMAC under a key the database does not hold; p_legacy_hash finds only an invite stored as a plain SHA-256 before that (ADR 0081).';

revoke all on function public.redeem_invite(uuid, bytea, text, bytea) from public;
revoke all on function public.redeem_invite(uuid, bytea, text, bytea) from anon, authenticated;
grant execute on function public.redeem_invite(uuid, bytea, text, bytea) to service_role;

-- supabase/sql/functions/public/reissue_invite.sql
-- ---------------------------------------------------------------------------
-- The service role's way to reissue a circle's invite (SUS-125).
--
-- "The invite key has leaked" (`docs/runbooks/environments.md`): every live
-- invite secret was derived from `INVITE_LINK_KEY`, so rotating the key alone
-- only makes the links unshowable; the old ones keep opening their circles.
-- `scripts/rotate-invite-key.mjs` derives a fresh secret under the new key for
-- every circle and calls this to swap it in. `issue_invite` cannot do that: it
-- is the owner's alone and reads `auth.uid()`, and there are thousands of
-- owners and one operator.
--
-- It names the invite it replaces and does nothing, returning false, if that
-- one is no longer live (an owner reset the link while the sweep ran).
--
-- Like `issue_invite` it takes a digest and never a secret, so the database
-- learns nothing it did not know. The old link is revoked in the same
-- statement as the new one is inserted, so there is no moment with two live
-- links (`circle_invites_one_live_idx`) or none.
--
-- **Not callable by a client.** Granted to `service_role` alone; the audit row
-- has no actor, which is how a reader tells an operator's rotation from an
-- owner's. No `circles.invite_rotated` event: the owner did nothing and has
-- nothing to be told; their next look at the link shows the new one.
-- ---------------------------------------------------------------------------

create or replace function public.reissue_invite(
  p_circle_id uuid,
  p_secret_hash bytea,
  p_invite_id uuid,
  p_replaces uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  issued public.circle_invites;
  revoked integer;
begin
  select c.owner_user_id into owner from public.circles c where c.id = p_circle_id;
  if not found then
    raise exception 'circle_not_found' using errcode = 'no_data_found';
  end if;

  -- Only the invite the sweep saw. If the owner reset the link between the
  -- read and this call, the live one is already theirs and already under the
  -- new key: revoking it would kill a link they may have just shared.
  update public.circle_invites i
  set revoked_at = now()
  where i.id = p_replaces and i.circle_id = p_circle_id and i.revoked_at is null;
  get diagnostics revoked = row_count;
  if revoked = 0 then
    return false;
  end if;

  -- Always an HMAC: the sweep computes it under the project's digest key (ADR 0081).
  insert into public.circle_invites (id, circle_id, secret_hash, digest_kind, created_by)
  values (p_invite_id, p_circle_id, p_secret_hash, 'hmac', owner)
  returning * into issued;

  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (null, 'circles.invite_reissued', 'circle', p_circle_id,
          jsonb_build_object('invite_id', issued.id));

  return true;
end;
$$;

comment on function public.reissue_invite(uuid, bytea, uuid, uuid) is
  'Replaces a circle''s live invite with one the service role derived under a new key, revoking the old. For the "invite key has leaked" runbook; service_role only.';

revoke all on function public.reissue_invite(uuid, bytea, uuid, uuid) from public;
revoke all on function public.reissue_invite(uuid, bytea, uuid, uuid) from anon, authenticated;
grant execute on function public.reissue_invite(uuid, bytea, uuid, uuid) to service_role;

-- END GENERATED: function definitions
