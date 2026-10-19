-- 0068_gates_read_product_tables (SUS-213)
--
-- Two of the founder's decision gates counted events the app sends, so a
-- signed-in member could raise their own circle's numbers by sending a few
-- hundred `member_reattached` or `email_verified` events (the ingest's rate
-- limit was the only bound; SUS-185 stopped them naming a circle they are not
-- in, and this closes the rest). Their numerators now come from the tables the
-- facts are written to, the way the north star always has:
--
--   * `gate_reattach.reattached`: completed reattachments by the Continue-as
--     list, one `circles.member_reattached` row of `private.audit_log` each
--     (written by `private.reattach_member_core` after the move succeeded),
--     counted for the circle's cohort on the day it happened.
--   * `gate_email_verified.verified`: a guest who submitted an address and then
--     has a verified `private.email_contacts` row (`verified_at` at or after
--     the submission), or whose claim was recorded in the audit log (signing
--     in with the code proves the address, the route the gate has always
--     counted). Neither is a thing a client can write.
--
-- What does not change: both views keep their columns, so `founder_analytics`
-- and its `by_source` split (SUS-171) are untouched; cohort attribution is the
-- same (a circle's cohort; a submitting guest's first-submission cohort).
--
-- What still comes from client events, and why that is bounded:
--
--   * `gate_reattach.missing` (`session_missing_on_return`): a denominator.
--     A session that is missing leaves no product row, so no table could hold
--     it. A forged one can only dilute the rate, never raise it.
--   * `gate_email_verified.submitted` (`email_submitted`): also a denominator,
--     bounded the same way.

create or replace view analytics.gate_reattach as
with missing as (
  select e.occurred_at::date as day, ec.cohort, count(*) as missing, 0::bigint as reattached
  from analytics.events e
  join analytics.event_cohort ec on ec.event_id = e.id
  where e.event_name = 'session_missing_on_return'
  group by 1, ec.cohort
),
reattached as (
  select a.occurred_at::date as day, cc.cohort, 0::bigint as missing, count(*) as reattached
  from private.audit_log a
  join analytics.circle_cohort cc on cc.circle_id = a.resource_id
  where a.action = 'circles.member_reattached'
    and a.resource_type = 'circle'
    and a.metadata ->> 'source' = 'list'
  group by 1, cc.cohort
)
select u.day, sum(u.missing)::bigint as missing, sum(u.reattached)::bigint as reattached, u.cohort
from (select * from missing union all select * from reattached) u
group by u.day, u.cohort;

-- A guest's cohort is the cohort of their first submission. `submitted.at` is the
-- client's clock and the proofs are the server's, so a proof counts from five
-- minutes before it.
create or replace view analytics.gate_email_verified as
with submitted as (
  select coalesce(e.user_id::text, e.anonymous_id) as actor,
         min(e.occurred_at) as at,
         (array_agg(ec.cohort order by e.occurred_at))[1] as cohort
  from analytics.events e
  join analytics.event_cohort ec on ec.event_id = e.id
  where e.event_name = 'email_submitted'
    and e.properties ? 'save_place'
    and coalesce(e.user_id::text, e.anonymous_id) is not null
  group by 1
),
verified as (
  select c.user_id::text as actor, c.verified_at as at
  from private.email_contacts c
  where c.verified_at is not null
  union all
  select a.actor_user_id::text, a.occurred_at
  from private.audit_log a
  where a.action = 'growth.account_claimed' and a.actor_user_id is not null
  union all
  select a.metadata ->> 'from_user_id', a.occurred_at
  from private.audit_log a
  where a.action = 'circles.member_claimed' and a.metadata ? 'from_user_id'
  union all
  -- The guest's events move to the account they sign in to, so the account is
  -- the actor too (an account claimed before has no new `growth.account_claimed`).
  select a.actor_user_id::text, a.occurred_at
  from private.audit_log a
  where a.action = 'circles.member_claimed' and a.actor_user_id is not null
)
select
  s.at::date as day,
  count(*) as submitted,
  count(*) filter (
    where exists (select 1 from verified v where v.actor = s.actor and v.at >= s.at - interval '5 minutes')
  ) as verified,
  s.cohort
from submitted s
group by 1, s.cohort;
