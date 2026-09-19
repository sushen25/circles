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
