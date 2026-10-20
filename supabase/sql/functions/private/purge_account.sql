-- ---------------------------------------------------------------------------
-- The end of an account deletion: thirty days on (S4-05, ADR 0083).
--
-- `public.delete_account` took the person out of every circle and signed them
-- out. This is the part that makes "nothing identifies them" true:
--
--   * circles they still own are deleted with their plans (an owner with nobody
--     to hand a circle to archived it; the auth user cannot go while
--     `circles.owner_user_id` points at it, and a circle with no owner and no
--     members is nothing anyone could open);
--   * the user's id is taken out of the places that hold it with no foreign key
--     to follow it: the audit log's actor, the audit rows about the account, and
--     the lists of who was free for a time;
--   * the auth user is deleted, and the cascade takes the profile, memberships,
--     attendance, nudge states, devices, contacts and everything else that
--     references it. The five history columns that used to block this
--     (`circle_invites.created_by`, `plans.organiser_user_id`,
--     `meetup_confirmations.confirmed_by`, `outcome_reports.reported_by`) now
--     `set null`, and `analytics.events.user_id` already did: the facts stay,
--     who they were about does not.
--
-- Called once per user from `jobs.run_retention`, each inside its own
-- subtransaction, so one person whose purge fails does not hold up the rest.
-- ---------------------------------------------------------------------------

create or replace function private.purge_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.circles c where c.owner_user_id = p_user_id;

  delete from jobs.outbox o where o.aggregate_type = 'account' and o.aggregate_id = p_user_id;

  update private.audit_log a set actor_user_id = null where a.actor_user_id = p_user_id;
  update private.audit_log a set resource_id = null
  where a.resource_type = 'account' and a.resource_id = p_user_id;
  update private.audit_log a set metadata = a.metadata - 'user_id'
  where a.metadata ->> 'user_id' = p_user_id::text;

  update public.meetup_confirmations k
  set available_user_ids = array_remove(k.available_user_ids, p_user_id)
  where k.available_user_ids @> array[p_user_id];
  update public.candidates c
  set available_user_ids = array_remove(c.available_user_ids, p_user_id)
  where c.available_user_ids @> array[p_user_id];

  delete from auth.users u where u.id = p_user_id;
end;
$$;

comment on function private.purge_account(uuid) is
  'Deletes an account whose thirty days are up: owned circles, the id in the logs and lists with no foreign key, then the auth user and its cascade (S4-05, ADR 0083). Only jobs.run_retention calls it.';

revoke all on function private.purge_account(uuid) from public;
revoke all on function private.purge_account(uuid) from anon, authenticated;
