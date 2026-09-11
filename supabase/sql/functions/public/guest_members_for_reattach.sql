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
-- ---------------------------------------------------------------------------

-- `volatile`, not `stable`, because counting a lookup is a write. The cost is a
-- function the planner cannot fold into a surrounding query; the benefit is that
-- the limit cannot be skipped by the one caller it is meant for.
create or replace function public.guest_members_for_reattach(p_short_code text)
returns table (member_user_id uuid, display_name text)
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
  select m.user_id, m.display_name_snapshot
  from public.circle_members m
  join public.circles c on c.id = m.circle_id
  join public.profiles p on p.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  where c.short_code = p_short_code
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
