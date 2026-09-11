-- ---------------------------------------------------------------------------
-- A membership is about to belong to somebody with a saved place, so its
-- emailed way in without signing in has to stop being one.
--
-- `enforce_reentry_for_guests` refuses to *issue* a re-entry token against a
-- permanent identity, and the same rule has to hold when a membership becomes a
-- permanent identity's. Spent rather than deleted, so that following the link
-- still finds something and `reattach_member` can offer that identity's sign-in
-- (§10's third outcome) instead of calling the link broken.
--
-- Called from two places, and the reason is ordering rather than duplication:
--
--   * `move_membership`, *before* it rewrites `circle_members.user_id`, because
--     `email_action_tokens.membership_user_id` follows that by cascade and the
--     trigger fires on it;
--   * `reconcile_contacts`, at the top, because the duplicate-merge path never
--     moves the membership at all — it reaches the token through the *contact*,
--     and the same refusal was waiting there.
--
-- Idempotent: `coalesce` leaves an already-spent token alone.
-- ---------------------------------------------------------------------------

create or replace function private.retire_reentry_links(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.user_id = p_to and p.is_permanent)
    and not exists (
      select 1 from auth.users u where u.id = p_to and not coalesce(u.is_anonymous, true)
    )
  then
    return;
  end if;

  update private.email_action_tokens t
  set used_at = coalesce(t.used_at, now())
  where t.purpose = 'reentry'
    and t.membership_circle_id = p_circle_id
    and t.membership_user_id = p_from;
end;
$$;

comment on function private.retire_reentry_links(uuid, uuid, uuid) is
  'Spends a membership''s outstanding re-entry links when it passes to an identity with a saved place. Spent, not deleted, so the emailed link can still route to sign-in.';

revoke all on function private.retire_reentry_links(uuid, uuid, uuid) from public;
revoke all on function private.retire_reentry_links(uuid, uuid, uuid) from anon, authenticated;
