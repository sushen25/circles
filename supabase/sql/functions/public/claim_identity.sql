-- ---------------------------------------------------------------------------
-- claim_identity
--
-- Somebody saves their place (§10): `linkIdentity` with an email code, or
-- `signInWithIdToken` with Apple or Google, on top of the anonymous session
-- they have been using as a guest. Two different things can have just happened,
-- and the client cannot tell them apart on its own:
--
--   * the identity was new, so Supabase attached it to the anonymous user —
--     same user id, `is_anonymous` now false, nothing to merge; or
--   * the identity already existed, so Supabase signed them in *as that user*
--     and the anonymous one is now abandoned along with its memberships.
--
-- The second is the case §10 means by "`claim-identity` to reconcile
-- memberships if the permanent identity already existed".
--
-- **Granted to `service_role` and nothing else.** This is the one function of
-- the three whose authorisation cannot live in SQL: the claim being made is "I
-- was also this anonymous user", and the only proof of it is that session's
-- access token, which the caller no longer holds as `auth.uid()`. The Edge
-- Function verifies that token and then calls this. Were it callable by
-- `authenticated`, `p_anonymous_user_id` would be an unchecked parameter naming
-- somebody else's guest membership — which is to say, a way to take it. A
-- definer function granted to a client role must never take the identity it
-- acts on as an argument; this one takes two, so it is not granted to one.
--
-- Idempotent. Saying it twice moves nothing the first call did not move, and
-- the audit row keeps `growth.account_claimed` from being counted twice.
-- ---------------------------------------------------------------------------

create or replace function public.claim_identity(
  p_user_id uuid,
  p_anonymous_user_id uuid,
  p_moment text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  merged integer := 0;
  membership record;
begin
  if p_user_id is null or p_anonymous_user_id is null then
    raise exception 'claim_identity needs both identities'
      using errcode = 'null_value_not_allowed';
  end if;

  -- The moment is an enum in `packages/contracts/analytics.ts`, and the event
  -- this writes is validated against that catalogue downstream. Refusing here
  -- turns a payload the pipeline would drop into an error the caller can see.
  if p_moment is null or p_moment not in
    ('after_answer', 'after_confirmed', 'after_attendance', 'settings') then
    raise exception 'claim_identity got an unknown moment'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A saved place is what is being claimed, so the destination must have one.
  -- Without this check an anonymous caller could have its own profile marked
  -- permanent — which takes it off every Continue-as list and makes its
  -- membership unreattachable, locking somebody out of their own way back in
  -- without a sign-in anywhere in the story. Read from `auth.users`, which only
  -- the auth server writes.
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and not coalesce(u.is_anonymous, true)
  ) then
    raise exception 'destination_is_not_permanent' using errcode = 'insufficient_privilege';
  end if;

  -- The durable record of the saved place. `handle_user_updated` sets this when
  -- the auth row stops being anonymous, which covers the `linkIdentity` case;
  -- this covers the other one, where the permanent user existed already and its
  -- profile may predate the column.
  update public.profiles p set is_permanent = true
  where p.user_id = p_user_id and not p.is_permanent;

  if p_anonymous_user_id <> p_user_id then
    -- Never merge *from* a saved place. Both identities belonging to one person
    -- is the premise; two saved places is two accounts, and moving memberships
    -- between them on a client's word would be a way to take one. The anonymous
    -- side has nothing to lose and no sign-in to bypass, which is exactly why it
    -- is the only side this accepts.
    if exists (
      select 1 from auth.users u
      where u.id = p_anonymous_user_id and not coalesce(u.is_anonymous, false)
    ) or exists (
      select 1 from public.profiles p
      where p.user_id = p_anonymous_user_id and p.is_permanent
    ) then
      raise exception 'source_is_permanent' using errcode = 'insufficient_privilege';
    end if;

    for membership in
      select m.circle_id
      from public.circle_members m
      where m.user_id = p_anonymous_user_id and m.status = 'active'
      -- Locked in a fixed order: two claims racing for one pair of identities
      -- would otherwise deadlock against each other half way through.
      order by m.circle_id
      for update
    loop
      if exists (
        select 1 from public.circle_members m
        where m.circle_id = membership.circle_id and m.user_id = p_user_id
      ) then
        -- Both identities are in this circle. The saved place is the one that
        -- keeps working on another device, so it stays and the guest row goes.
        -- `on_member_removed` does the rest — the duplicate's answers, its place
        -- in the participant list, and its `going` on anything still ahead.
        update public.circle_members m
        set status = 'removed'
        where m.circle_id = membership.circle_id and m.user_id = p_anonymous_user_id;
      else
        -- The name the circle knows them by travels with the membership rather
        -- than being replaced by the profile's. Nobody's roster entry should
        -- change because somebody else signed in.
        perform private.move_membership(membership.circle_id, p_anonymous_user_id, p_user_id);
        merged := merged + 1;
      end if;
    end loop;
  end if;

  -- Once per account, whatever the client retries. The audit log is the record
  -- rather than the outbox, because the outbox is drained and swept and this has
  -- to stay true for longer than that.
  if not exists (
    select 1 from private.audit_log a
    where a.action = 'growth.account_claimed' and a.resource_id = p_user_id
  ) then
    insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
    values (p_user_id, 'growth.account_claimed', 'account', p_user_id,
            jsonb_build_object('moment', p_moment, 'merged_memberships', merged));

    perform jobs.emit('growth.account_claimed', 'account', p_user_id,
      jsonb_build_object('user_id', p_user_id, 'moment', p_moment));
  end if;

  return merged;
end;
$$;

comment on function public.claim_identity(uuid, uuid, text) is
  'Reconciles an anonymous identity''s memberships onto a permanent one after sign-in (§10). Service role only: the anonymous identity is a parameter, and its proof is a token only the Edge Function can check.';

revoke all on function public.claim_identity(uuid, uuid, text) from public;
revoke all on function public.claim_identity(uuid, uuid, text) from anon, authenticated;
grant execute on function public.claim_identity(uuid, uuid, text) to service_role;
