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
  -- sign-in instead". Reading the JWT rather than `profiles`, because a row the
  -- caller can update is not a credential (`auth_is_permanent`).
  if public.auth_is_permanent() then
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
      raise exception 'token_invalid' using errcode = 'no_data_found';
    end if;

    target_circle := token.membership_circle_id;
    target := token.membership_user_id;

    update private.email_action_tokens t set used_at = now() where t.id = token.id;
  end if;

  -- Serialises two reattachments of the same membership: without it both read
  -- a chain of two and both decide they are the third.
  select * into chosen from public.circles c where c.id = target_circle for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  if target = caller then
    -- Already theirs. A retry, or the link opened twice: the answer is the
    -- circle, and no second row in the audit log spending the allowance.
    return chosen;
  end if;

  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = target and m.status = 'active'
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
  perform private.move_membership(target_circle, target, caller);

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
