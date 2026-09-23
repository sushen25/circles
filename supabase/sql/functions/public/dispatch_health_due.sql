-- ---------------------------------------------------------------------------
-- Whether today's health summary is still owed.
--
-- Split from `public.dispatch_health` so that the claim can be made **after**
-- the letter is out rather than before it. Claiming first meant a provider
-- having a bad morning took the whole day's report with it: the first run
-- after 08:00 UTC wrote the audit row, the send failed with a retryable code,
-- and the remaining fourteen hundred runs that day found the day already
-- claimed and reported nothing — at exactly the moment somebody would want to
-- know (review round 3).
--
-- Read-only, and cheap: two conditions on one row. The dispatcher asks it
-- every minute and does nothing further on a no.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_health_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select now() >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '8 hours'
    and not exists (
      select 1 from private.audit_log a
      where a.action = 'health.reported'
        and a.occurred_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );
$$;

comment on function public.dispatch_health_due() is
  'True when today''s health summary is due (from 08:00 UTC) and has not been claimed. Service role only (S1-20).';

revoke all on function public.dispatch_health_due() from public;
revoke all on function public.dispatch_health_due() from anon, authenticated;
grant execute on function public.dispatch_health_due() to service_role;
