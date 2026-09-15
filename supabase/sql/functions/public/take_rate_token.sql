-- ---------------------------------------------------------------------------
-- One fixed window, one counter, one answer: may this happen?
--
-- The window is derived from the clock rather than stored, so there is no
-- bookkeeping to get wrong and no row to expire before it is read: every caller
-- in the same window computes the same `window_start` and lands on the same row.
--
-- Counting happens whether or not the answer is yes. A refused attempt is still
-- an attempt, and a limiter that only counts successes is one that can be held
-- open indefinitely by failing.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.
-- ---------------------------------------------------------------------------

create or replace function public.take_rate_token(
  p_scope text,
  p_key_hash bytea,
  p_limit integer,
  p_window interval,
  -- What this attempt costs. One for a request; more for a request that carries
  -- many of whatever is being limited — a batch of fifty analytics events is
  -- fifty events, and charging it as one made "six hundred a minute" mean
  -- thirty thousand.
  p_cost integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  seconds double precision := extract(epoch from p_window);
  bucket_start timestamptz;
  taken integer;
begin
  if p_limit < 1 or seconds <= 0 or p_cost < 1 then
    raise exception 'take_rate_token needs a positive limit, window and cost'
      using errcode = 'invalid_parameter_value';
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / seconds) * seconds);

  insert into jobs.rate_counters (scope, key_hash, window_start, count)
  values (p_scope, p_key_hash, bucket_start, p_cost)
  on conflict (scope, key_hash, window_start)
    do update set count = jobs.rate_counters.count + p_cost
  returning count into taken;

  return taken <= p_limit;
end;
$$;

comment on function public.take_rate_token(text, bytea, integer, interval, integer) is
  'Counts an attempt in the current fixed window and says whether it is within the limit — `p_cost` for a request that carries many of whatever is limited. Counts refusals too.';

revoke all on function public.take_rate_token(text, bytea, integer, interval, integer) from public;
revoke all on function public.take_rate_token(text, bytea, integer, interval, integer) from anon, authenticated;
grant execute on function public.take_rate_token(text, bytea, integer, interval, integer) to service_role;
