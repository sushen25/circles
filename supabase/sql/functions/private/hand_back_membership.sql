-- ---------------------------------------------------------------------------
-- Take one circle's membership back from a saved account (ADR 0049, decision 6).
--
-- `reattach_member` calls this after `private.takeback_allowed` has said yes. It
-- moves the membership the way every move does, through `move_membership`, with
-- three differences that exist because the holder is an account with a life
-- outside this circle:
--
--   * **Only this circle's membership moves.** `move_membership` is already scoped
--     to one circle; the account keeps its other circles, its sign-in and its
--     profile, and nothing about them is read or written here.
--   * **Only the link's address moves.** A guest-to-guest move carries every
--     address attached to the place, and here the holder's own sign-in address may
--     be among them. `reconcile_contacts` is told, through a transaction-local
--     setting, to move the one contact the link names and leave the rest, so the
--     account's address and consent are never handed to somebody else.
--   * **The holder's other links for this circle are deleted first.** A re-entry
--     link names a membership and a contact that must belong to that membership's
--     holder; links for the holder's other addresses would be left pointing at a
--     person who no longer holds the place. They are the holder's, and a link that
--     can no longer move anything is of no use to them.
-- ---------------------------------------------------------------------------

create or replace function private.hand_back_membership(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid,
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_hash bytea;
begin
  select k.email_hash into link_hash from private.email_contacts k where k.id = p_contact_id;
  if link_hash is null then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  delete from private.email_action_tokens t
  where t.purpose = 'reentry'
    and t.membership_circle_id = p_circle_id
    and t.membership_user_id = p_from
    and t.contact_id <> p_contact_id;

  perform set_config('circles.takeback_email_hash', encode(link_hash, 'hex'), true);
  perform private.move_membership(p_circle_id, p_from, p_to);
  perform set_config('circles.takeback_email_hash', '', true);
end;
$$;

comment on function private.hand_back_membership(uuid, uuid, uuid, uuid) is
  'Moves one circle membership from a saved account to a guest identity named by an emailed link: that circle only, only the link''s address, the account''s other links for it deleted.';

revoke all on function private.hand_back_membership(uuid, uuid, uuid, uuid) from public;
revoke all on function private.hand_back_membership(uuid, uuid, uuid, uuid) from anon, authenticated;
