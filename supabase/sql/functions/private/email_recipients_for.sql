-- ---------------------------------------------------------------------------
-- Who may be emailed about a plan.
--
-- Written once, here, because it is the join that "a **verified** email
-- subscription to this plan" (the domain's `hasPlanEmailSubscription`) actually
-- means, and because the dispatcher (S1-20) is not the place to work it out
-- again. Three conditions, and dropping any one of them sends mail somebody did
-- not ask for:
--
--   * the contact is **verified** — an address typed wrong has a pending
--     contact, and consent recorded against it is consent from whoever owns the
--     address, not from whoever typed it;
--   * the subscription is **active** — asked for, and not stopped since;
--   * the person is still an **active member** of the circle, because "only
--     active members see or act on it" (AGENTS.md) does not stop being true
--     because the channel is email.
--
-- It returns ids, never addresses: the address is read once, by the sender,
-- from the row this points at.
-- ---------------------------------------------------------------------------

create or replace function private.email_recipients_for(p_plan_id uuid)
returns table (contact_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.user_id
  from private.email_subscriptions s
  join private.email_contacts c on c.id = s.contact_id
  join public.plans p on p.id = s.plan_id
  join public.circle_members m on m.circle_id = p.circle_id and m.user_id = c.user_id
  where s.plan_id = p_plan_id
    and s.scope = 'plan_updates'
    and s.status = 'active'
    and c.status = 'verified'
    and m.status = 'active'
  order by c.id;
$$;

comment on function private.email_recipients_for(uuid) is
  'The contacts that may receive plan-update email for one plan: verified contact, active subscription, active member. Ids only, never addresses.';

revoke all on function private.email_recipients_for(uuid) from public;
revoke all on function private.email_recipients_for(uuid) from anon, authenticated;
grant execute on function private.email_recipients_for(uuid) to service_role;
