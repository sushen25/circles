-- ---------------------------------------------------------------------------
-- 0017 — joining a circle from a plan's link (ADR 0022, S1-24c).
--
-- `public.join_from_plan`, which the `join-plan` Edge Function calls, and
-- `private.admit_member`, the cap, name and rejoin rules it shares with
-- `redeem_invite` — which is carried again here because it now calls the
-- helper rather than holding its own copy. The reasoning is in each function's
-- file under `supabase/sql/functions/`, which is the definition (ADR 0015);
-- this migration only carries them.
--
-- A new migration rather than a regenerated `0016`, because `0016` has shipped.
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/private/admit_member.sql
-- ---------------------------------------------------------------------------
-- Admitting somebody to a circle: the rules every way in shares.
--
-- There are two ways in. `redeem_invite` admits whoever holds the circle's
-- invite secret; `join_from_plan` admits whoever holds the short code of a plan
-- that is taking answers (ADR 0022). What authorises each is different and
-- stays in each. What happens once somebody *is* authorised is the same, and is
-- here, because two copies of "the cap, the name, rejoining after removal" are
-- two copies that will disagree the first time one of them is fixed.
--
-- **The caller holds the circle's row lock.** Both callers take it with
-- `for update` before calling, and this relies on it: the cap and the name are
-- only true of a roster nobody else is adding to at the same time.
-- `enforce_member_cap` takes the same lock, so the check below and the rule on
-- the write see one roster rather than two.
--
-- Returns true when this call made the person an active member, and false when
-- they already were — a retry, a second tap, a link opened twice in one
-- browser. The caller decides what that means for it: `redeem_invite` counts a
-- use only for a true.
--
-- Decides nothing about *whether* the person may join. It is not callable by a
-- client, and it must not become the thing somebody calls to skip the check.
-- ---------------------------------------------------------------------------

create or replace function private.admit_member(
  p_circle_id uuid,
  p_user_id uuid,
  p_display_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.circle_members;
  violated text;
begin
  select * into existing
  from public.circle_members m
  where m.circle_id = p_circle_id and m.user_id = p_user_id;

  if found and existing.status = 'active' then
    return false;
  end if;

  -- The cap, checked here for the *message* rather than for the rule. The rule
  -- is `enforce_member_cap`, which fires on the write below whoever makes it;
  -- this reads the same count under the same circle lock, so it cannot give a
  -- different answer, and it lets the caller be told `circle_full` instead of
  -- a trigger's exception text — which names the circle and the cap.
  if (
    select count(*) from public.circle_members m
    where m.circle_id = p_circle_id and m.status = 'active' and m.user_id <> p_user_id
  ) >= public.member_cap() then
    raise exception 'circle_full' using errcode = 'check_violation';
  end if;

  -- A removed member holding a live way in joins again. Removal and link
  -- rotation are separate tools in spec §5.2 — "the owner can remove a member
  -- **and** reset the link" — and the link is the capability. Rejoining runs
  -- the cap and the name check again, and `on_member_changed` announces it, so
  -- the owner sees it happen rather than finding out later.
  begin
    if found then
      update public.circle_members m
      set status = 'active', display_name_snapshot = p_display_name
      where m.circle_id = p_circle_id and m.user_id = p_user_id;
    else
      insert into public.circle_members (circle_id, user_id, display_name_snapshot)
      values (p_circle_id, p_user_id, p_display_name);
    end if;
  exception
    when unique_violation then
      -- Which unique index, not "a unique index". `circle_members_active_name_idx`
      -- is the name rule; the primary key is the same person arriving twice at
      -- once from two tabs, which is a retry and not a name collision. Reporting
      -- the second as `duplicate_name` would send the client to ask for a new
      -- name it does not need.
      get stacked diagnostics violated = constraint_name;
      if violated = 'circle_members_active_name_idx' then
        -- The name check is the index rather than a read-then-write, because two
        -- people joining at once is exactly when a read-then-write loses: the
        -- second reads a roster that does not yet hold the first. The client's
        -- answer is to ask for another name (spec §9).
        raise exception 'duplicate_name' using errcode = 'unique_violation';
      end if;
      raise;
    when check_violation then
      -- `circle_members_name_length` is on the *canonical* form, which strips
      -- combining marks — so a name of nothing but marks passes the request
      -- schema (the domain normalises whitespace, not marks) and fails here.
      -- Named rather than caught wholesale, so that the member cap and every
      -- other check keep their own answers.
      get stacked diagnostics violated = constraint_name;
      if violated = 'circle_members_name_length' then
        raise exception 'display_name_unusable' using errcode = 'check_violation';
      end if;
      raise;
    when not_null_violation then
      -- No name at all. Both callers refuse this before they get here; this is
      -- the answer if one of them stops, rather than a 500 naming a column.
      raise exception 'display_name_unusable' using errcode = 'check_violation';
  end;

  return true;
end;
$$;

comment on function private.admit_member(uuid, uuid, text) is
  'Makes a person an active member of a circle whose row the caller has locked: the cap, the name rules and rejoining after removal. Shared by redeem_invite and join_from_plan; decides nothing about whether they may join. True when this call admitted them.';

revoke all on function private.admit_member(uuid, uuid, text) from public;
revoke all on function private.admit_member(uuid, uuid, text) from anon, authenticated;

-- supabase/sql/functions/public/join_from_plan.sql
-- ---------------------------------------------------------------------------
-- join_from_plan
--
-- Joining a circle from the link the group chat actually sees (ADR 0022).
--
-- The message an organiser pastes carries only the plan's link, `/j/<code>`.
-- Until ADR 0022 that link was a dead end for anybody new: the circle's invite
-- secret was the only thing that could create a membership, and a plan link
-- does not carry it. Now **the plan's short code admits, while the plan is
-- taking answers**, and joining through it makes the person one of the people
-- that plan is asking.
--
-- **What authorises it is the code and the plan's state, together.** Only a
-- plan in `collecting` or `ready` whose response deadline is still ahead, in an
-- active circle — the domain's `acceptsAnswers`, and the same two conditions
-- `replace_response` checks. A quiet ask still `seeking`, a confirmed plan, a
-- finished, expired or cancelled one, and a code that does not exist all get
-- one answer, `invite_inactive`. That is the whole of the promise: **a refusal
-- does not say why.** It does not hide that a plan is taking answers — a join
-- that succeeds says so — and `preview_for_code` already names the circle
-- behind any code; what it must not add is a way to tell a quiet ask from a
-- cancelled plan by how the door is shut.
--
-- The code is weak on purpose (ADR 0022's consequences): eight characters,
-- in URL paths, not revocable, bounded by the deadline. What makes that
-- acceptable is that guessing is slow — Turnstile, and limits per code and per
-- address — and those live in the `join-plan` Edge Function, because only it
-- can see a Turnstile token or the caller's address.
--
-- **So this is the service role's, and the person joining is a parameter.**
-- `redeem_invite` is granted to `authenticated` and acts on `auth.uid()`, and
-- it can be: its secret is 256 bits, so a client calling the RPC directly and
-- skipping the function's limits gains volume and nothing else. Here the same
-- grant was the hole. Any session, an anonymous one included, could call
-- `/rest/v1/rpc/join_from_plan` as often as it liked, and every guess that
-- landed was a seat in somebody's circle. Taking the grant away makes the Edge
-- Function the only way in, which is `claim_identity`'s shape for the same
-- reason: the proof the database cannot check is checked before it is called.
-- The id comes from the caller's verified JWT (`actor.userId`), never from the
-- request body.
--
-- **Already a member.** No name is read. The person is added to the plan's
-- current revision if they are not on it, which is spec §9's "new members may
-- opt into the active plan": somebody who joined through the invite while this
-- plan was running was never asked, and opening its link asks them. No
-- membership is written, so no join is announced.
--
-- **A new member** is admitted by `private.admit_member`, under the circle's
-- lock — the cap, the name and rejoining after removal, exactly as an invite
-- does it — and added to the plan in the same transaction. A guest must give a
-- name. A saved place may leave it out and joins under their profile's name,
-- which names the membership in this circle and nothing else: after a
-- `duplicate_name` they pass one, and their profile is not touched.
--
-- **The quorum does not move** (ADR 0022, ADR 0017). It was set when the plan
-- was made and changes only when the organiser changes it.
--
-- **The input version does**, when somebody is added to the plan. The roster is
-- engine input — `engine_input` reads `plan_participants`, and the set it
-- stores says "4 of 7" — so a set computed before the join is a set about a
-- different audience, which is what `on_member_removed` says for the opposite
-- move. The Edge Function recalculates in the same request (ADR 0018). A call
-- that adds nobody bumps nothing: an organiser looking at the set must not have
-- it replaced because somebody already on the plan opened its link again.
--
-- Returns the circle, the plan's id, and whether this call added the caller to
-- the plan — the last so the Edge Function recalculates only when something
-- changed.
-- ---------------------------------------------------------------------------

create or replace function public.join_from_plan(
  -- Who is joining: the verified caller, as `join-plan` resolved them.
  p_user_id uuid,
  p_short_code text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := p_user_id;
  found_plan_id uuid;
  plan public.plans;
  target public.circles;
  chosen_name text := p_display_name;
  added integer;
begin
  if caller is null then
    raise exception 'join_from_plan requires the person joining'
      using errcode = 'insufficient_privilege';
  end if;

  -- Shape first, as `preview_for_code` does: rubbish never reaches the tables.
  -- The short-code alphabet has no `i`, `l`, `o`, `0` or `1` in it.
  if p_short_code is null or p_short_code !~ '^[a-hjkmnp-z2-9]{6,12}$' then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  select p.id into found_plan_id from public.plans p where p.short_code = p_short_code;
  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- Circle before plan, the order `create_plan` and `on_member_removed` take
  -- the same two locks in; transactions that lock in one order cannot deadlock
  -- over them. The circle's lock serialises joins, which is what the cap and
  -- the name check depend on. The plan's holds it in the state it is judged in
  -- below: a confirm or a cancel committing between the check and the insert
  -- would otherwise add somebody to a plan that was no longer asking.
  select c.* into target
  from public.circles c
  join public.plans p on p.circle_id = c.id
  where p.id = found_plan_id
  for update of c;

  select * into plan from public.plans p where p.id = found_plan_id for update;

  -- One answer for every way a plan is not admitting. The detail stays out of
  -- the message on purpose: `_shared/problem.ts` maps the message, and the
  -- message is what the caller sees.
  if target.status <> 'active'
    or plan.state not in ('collecting', 'ready')
    or now() >= plan.response_deadline
  then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target.id and m.user_id = caller and m.status = 'active'
  ) then
    -- A saved place's profile name, when they gave none. Read from
    -- `auth.users` rather than the JWT claim, which `reattach_member` explains:
    -- a token issued minutes before somebody saved their place still says
    -- `is_anonymous: true`.
    if chosen_name is null and exists (
      select 1 from auth.users u where u.id = caller and not coalesce(u.is_anonymous, true)
    ) then
      select pr.display_name into chosen_name from public.profiles pr where pr.user_id = caller;
    end if;

    if chosen_name is null then
      raise exception 'display_name_unusable' using errcode = 'check_violation';
    end if;

    perform private.admit_member(target.id, caller, chosen_name);
  end if;

  insert into public.plan_participants (plan_id, revision, user_id)
  values (plan.id, plan.revision, caller)
  on conflict do nothing;
  get diagnostics added = row_count;

  if added > 0 then
    update public.plans p
    set input_version = p.input_version + 1
    where p.id = plan.id;
  end if;

  return jsonb_build_object(
    'circle', to_jsonb(target),
    'plan_id', plan.id,
    'newly_asked', added > 0
  );
end;
$$;

comment on function public.join_from_plan(uuid, text, text) is
  'Joins a person to the circle behind a plan short code while that plan is taking answers, and adds them to its current revision (ADR 0022). Idempotent; never changes the quorum. Raises invite_inactive for every plan that is not admitting, or duplicate_name, display_name_unusable, circle_full. Service role only: Turnstile and the rate limits that make a short code acceptable are in the join-plan Edge Function, and a client calling this directly would skip them.';

revoke all on function public.join_from_plan(uuid, text, text) from public;
revoke all on function public.join_from_plan(uuid, text, text) from anon, authenticated;
grant execute on function public.join_from_plan(uuid, text, text) to service_role;

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
-- What this function enforces cannot be bypassed by calling it directly: the
-- invite must be live, the cap holds, the name must be free, and the membership
-- lands on `auth.uid()` rather than on anything the caller says. Turnstile and
-- the per-IP limit live in the Edge Function because they are abuse controls
-- rather than authorisation — skipping them lets somebody make more requests,
-- not make a request the database would have refused.
--
-- Idempotent by its own state rather than by a key column: being an active
-- member of the circle *is* the record that this already happened, so a retry
-- returns the circle and writes nothing. (`create_circle` carries a
-- `creation_key` because a circle has no such natural record — asking twice
-- would leave two circles and no way to tell which link was shared.)
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(
  p_secret_hash bytea,
  p_display_name text
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  invite public.circle_invites;
  target public.circles;
begin
  if caller is null then
    raise exception 'redeem_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
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

comment on function public.redeem_invite(bytea, text) is
  'Joins the caller to the circle behind an invite digest. Idempotent on an existing active membership; raises invite_inactive, duplicate_name or circle_full.';

revoke all on function public.redeem_invite(bytea, text) from public;
revoke all on function public.redeem_invite(bytea, text) from anon, authenticated;
grant execute on function public.redeem_invite(bytea, text) to authenticated;

-- END GENERATED: function definitions
