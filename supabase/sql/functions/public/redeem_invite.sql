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
  existing public.circle_members;
  violated text;
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

  select * into existing
  from public.circle_members m
  where m.circle_id = target.id and m.user_id = caller;

  if found and existing.status = 'active' then
    -- Already in. A retry, a second tap, or the link opened twice in one
    -- browser: nothing to do, and in particular no second use counted.
    return target;
  end if;

  -- The cap, checked here for the *message* rather than for the rule. The rule
  -- is `enforce_member_cap`, which fires on the write below whoever makes it;
  -- this reads the same count under the same circle lock, so it cannot give a
  -- different answer, and it lets the caller be told `circle_full` instead of
  -- a trigger's exception text — which names the circle and the cap.
  if (
    select count(*) from public.circle_members m
    where m.circle_id = target.id and m.status = 'active' and m.user_id <> caller
  ) >= public.member_cap() then
    raise exception 'circle_full' using errcode = 'check_violation';
  end if;

  -- A removed member redeeming a live link joins again. Removal and link
  -- rotation are separate tools in spec §5.2 — "the owner can remove a member
  -- **and** reset the link" — and the link is the capability. Rejoining runs
  -- the cap and the name check again, and `on_member_changed` announces it, so
  -- the owner sees it happen rather than finding out later.
  if found then
    update public.circle_members m
    set status = 'active', display_name_snapshot = p_display_name
    where m.circle_id = target.id and m.user_id = caller;
  else
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values (target.id, caller, p_display_name);
  end if;

  update public.circle_invites i
  set use_count = i.use_count + 1
  where i.id = invite.id;

  return target;

exception
  when unique_violation then
    -- Which unique index, not "a unique index". `circle_members_active_name_idx`
    -- is the name rule; the primary key is the same caller arriving twice at
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
    -- combining marks — so a name of nothing but marks passes the request schema
    -- (the domain normalises whitespace, not marks) and fails here. Named rather
    -- than caught wholesale, so that the member cap and every other check keep
    -- their own answers.
    get stacked diagnostics violated = constraint_name;
    if violated = 'circle_members_name_length' then
      raise exception 'display_name_unusable' using errcode = 'check_violation';
    end if;
    raise;
end;
$$;

comment on function public.redeem_invite(bytea, text) is
  'Joins the caller to the circle behind an invite digest. Idempotent on an existing active membership; raises invite_inactive, duplicate_name or circle_full.';

revoke all on function public.redeem_invite(bytea, text) from public;
revoke all on function public.redeem_invite(bytea, text) from anon, authenticated;
grant execute on function public.redeem_invite(bytea, text) to authenticated;
