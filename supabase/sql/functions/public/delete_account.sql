-- ---------------------------------------------------------------------------
-- Deleting an account (spec §12, §13; architecture §9.1; S4-05, ADR 0083).
--
-- "Delete my account and data": a permanent identity asks to go, and from the
-- moment this returns they are gone to everybody else and to the product, and
-- nothing identifies them to anybody but us for thirty days. The thirty days
-- end in `private.purge_account`, run by `jobs.run_retention`, which deletes
-- the profile, the `private.*` rows and the auth user itself.
--
-- All of it is one transaction, because half a deletion is the worst outcome:
-- somebody who has been told they are deleted and can still sign in.
--
--   1. Circles they own. A circle always has an owner while it is active, so it
--      is handed to the longest-standing permanent member, or archived when
--      there is none (and deleted with the account at the purge). The UI asks
--      first and shows which of the two will happen (`account_deletion_preview`).
--   2. Plans they organise go to the longest-standing member who could organise
--      one (an active, permanent participant of the current revision), or to
--      nobody: a plan with no organiser is a legal state already (the quiet
--      ask), and nothing is cancelled in silence.
--   3. Memberships end as the owner's Remove ends them, so
--      `public.on_member_removed` does what it always does (answers and windows
--      deleted, input versions bumped, a ready plan back to collecting, a meetup
--      still ahead stops counting them) and the name other members see becomes
--      'Former member'. The caller recalculates the plans returned.
--   4. Email: subscriptions withdrawn, letters still waiting skipped, and their
--      contacts deleted (not suppressed: a suppression is a tombstone for the
--      *address*, and would silence a person who comes back). Push devices are
--      disabled.
--   5. Sign-in: sessions deleted and the user banned, here, in the same
--      transaction, so "cannot sign in" does not depend on a second call
--      succeeding. The Edge Function also revokes the session through the auth
--      API; this is the part that cannot be skipped.
--
-- Safe to repeat: a second call finds the account already deleting and returns
-- the same shape with nothing left to do.
-- ---------------------------------------------------------------------------

create or replace function public.delete_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  owned record;
  mine record;
  heir uuid;
  n_transferred integer := 0;
  n_archived integer := 0;
  stale uuid[] := '{}';
begin
  if caller is null then
    raise exception 'delete_account requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from private.account_deletions d where d.user_id = caller) then
    return jsonb_build_object('stale_plans', '[]'::jsonb, 'transferred', 0, 'archived', 0);
  end if;
  if not public.auth_is_permanent() then
    raise exception 'requires_saved_place' using errcode = 'insufficient_privilege';
  end if;

  -- Every circle they are in, locked first and in id order: the order
  -- `remove_member`, `leave_circle` and `create_plan` lock in (circle, then
  -- its plans), so a removal racing this cannot deadlock with it.
  perform 1 from public.circles c
  where c.id in (select m.circle_id from public.circle_members m where m.user_id = caller)
     or c.owner_user_id = caller
  order by c.id
  for update;

  -- 1. Circles they own, in id order so two deletions racing cannot deadlock.
  for owned in
    select c.id from public.circles c
    where c.owner_user_id = caller
    order by c.id
  loop
    select m.user_id into heir
    from public.circle_members m
    join public.profiles p on p.user_id = m.user_id
    where m.circle_id = owned.id and m.status = 'active'
      and m.user_id <> caller and p.is_permanent
    order by m.joined_at, m.user_id
    limit 1;

    if heir is null then
      -- An archived circle with nobody to go to stays as it is, and is deleted
      -- with the account at the purge, as the preview said.
      update public.circles set status = 'archived' where id = owned.id and status = 'active';
      n_archived := n_archived + 1;
    else
      update public.circles set owner_user_id = heir where id = owned.id;
      update public.circle_members set role = 'owner'
        where circle_id = owned.id and user_id = heir;
      update public.circle_members set role = 'member'
        where circle_id = owned.id and user_id = caller;
      n_transferred := n_transferred + 1;
    end if;
  end loop;

  -- 2. Plans they organise that still have a future, in every circle they are in.
  for mine in
    select distinct m.circle_id from public.circle_members m
    where m.user_id = caller and m.status = 'active'
    order by m.circle_id
  loop
    perform private.hand_on_plans(caller, mine.circle_id);
  end loop;

  -- 3. Memberships. The trigger does the rest of removal.
  update public.circle_members m
  set status = 'removed', display_name_snapshot = 'Former member', updated_at = now()
  where m.user_id = caller and m.status = 'active';

  -- Rows that were removed long ago carry the name too.
  update public.circle_members m
  set display_name_snapshot = 'Former member', updated_at = now()
  where m.user_id = caller and m.display_name_snapshot <> 'Former member';

  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into stale
  from public.plans p
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = caller
  where p.state in ('collecting', 'ready');

  -- 4. Email and push.
  update private.email_subscriptions s
  set status = 'withdrawn', withdrawn_at = now()
  where s.user_id = caller and s.status = 'active';

  update jobs.notification_jobs j
  set status = 'skipped', last_error = 'account_deleted', updated_at = now()
  where j.status = 'scheduled'
    and (j.user_id = caller
         or j.contact_id in (select c.id from private.email_contacts c where c.user_id = caller));

  delete from private.email_contacts c where c.user_id = caller;

  update private.push_devices d set enabled = false where d.user_id = caller;

  -- 5. Sign-in. A hundred years is "for ever" to the auth server, which reads
  -- `banned_until` as a time; the purge deletes the user outright.
  delete from auth.sessions s where s.user_id = caller;
  update auth.users u set banned_until = now() + interval '100 years' where u.id = caller;

  insert into private.account_deletions (user_id) values (caller);

  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'identity.account_deleted', 'account', caller,
          jsonb_build_object('transferred', n_transferred, 'archived', n_archived));
  perform jobs.emit('identity.account_deleted', 'account', caller, '{}'::jsonb);

  return jsonb_build_object(
    'stale_plans', to_jsonb(stale),
    'transferred', n_transferred,
    'archived', n_archived
  );
end;
$$;

comment on function public.delete_account() is
  'Deletes the calling permanent identity now and the rest in thirty days (S4-05, ADR 0083): owned circles handed on or archived, memberships ended as a removal, email withdrawn and contacts deleted, sessions gone and the user banned. Returns the plans to recalculate.';

revoke all on function public.delete_account() from public;
revoke all on function public.delete_account() from anon, authenticated;
grant execute on function public.delete_account() to authenticated;
