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
