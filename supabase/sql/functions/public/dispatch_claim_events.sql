-- ---------------------------------------------------------------------------
-- The outbox drain's read (ADR 0003).
--
-- **By `seq`, not `occurred_at`.** `occurred_at` defaults to `now()`, which is
-- the transaction's start, so every event written by one transaction carries
-- the same value and their order is whatever the sort happens to give. `seq`
-- is an identity column and cannot tie (S1-11).
--
-- `for update skip locked` belongs to the pattern even though the lease
-- already serialises runs: the lease is a row somebody has to honour, and this
-- is the database refusing. The lock lasts for this statement's transaction,
-- which is one PostgREST request — long enough to keep two runs off the same
-- row, not long enough to hold a row while it is being handled. What actually
-- makes handling safe to repeat is the idempotency key on every job it
-- produces.
--
-- A row is returned with its `attempts`, because the dispatcher decides
-- whether a failure has been retried enough, and one JSON document rather than
-- a set, because that is what a PostgREST `rpc` hands back in one piece.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_claim_events(p_limit integer default 200)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.seq), '[]'::jsonb)
  from (
    select o.id, o.seq, o.event_name, o.aggregate_type, o.aggregate_id, o.payload, o.attempts
    from jobs.outbox o
    where o.processed_at is null
    order by o.seq
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  ) e;
$$;

comment on function public.dispatch_claim_events(integer) is
  'The next unprocessed outbox events in seq order, skipping any another run holds. Service role only (S1-20).';

revoke all on function public.dispatch_claim_events(integer) from public;
revoke all on function public.dispatch_claim_events(integer) from anon, authenticated;
grant execute on function public.dispatch_claim_events(integer) to service_role;
