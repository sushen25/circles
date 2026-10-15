-- SUS-96: `dispatch_handed_off_since`, the question the drain asks before it
-- writes the sweep's "replies are closed", so a plan handed on after its
-- deadline is not announced to its new organiser twice.
--
-- The outbox is read and nothing else, so the plan id is just a uuid.

begin;
select plan(7);

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select ok(
  not has_function_privilege('authenticated', 'public.dispatch_handed_off_since(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_handed_off_since(uuid, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.dispatch_handed_off_since(uuid, timestamptz)', 'execute'),
  'only the service role asks'
);

-- Two plans, so one answer cannot leak into the other.
insert into jobs.outbox (event_name, aggregate_type, aggregate_id, occurred_at, processed_at)
values
  -- Plan A: handed on, and the drain finished with it at 10:05.
  ('planning.organiser_changed', 'plan', '00000000-0000-4000-8000-0000000000a1',
   '2026-09-20 10:04:00+00', '2026-09-20 10:05:00+00'),
  -- Plan B: handed on, but not yet drained.
  ('planning.organiser_changed', 'plan', '00000000-0000-4000-8000-0000000000b1',
   '2026-09-20 10:04:00+00', null),
  -- Plan C: something else drained after the deadline.
  ('planning.plan_cancelled', 'plan', '00000000-0000-4000-8000-0000000000c1',
   '2026-09-20 10:04:00+00', '2026-09-20 10:05:00+00');

select pg_temp.act_as_service();

select is(
  public.dispatch_handed_off_since('00000000-0000-4000-8000-0000000000a1', '2026-09-20 10:00:00+00'),
  true,
  'a hand-off the drain finished with after the deadline covers it'
);
select is(
  public.dispatch_handed_off_since('00000000-0000-4000-8000-0000000000a1', '2026-09-20 10:05:00+00'),
  true,
  'at the very instant it was finished with, as well'
);
select is(
  public.dispatch_handed_off_since('00000000-0000-4000-8000-0000000000a1', '2026-09-20 10:06:00+00'),
  false,
  'a hand-off finished with before the deadline (an extended one) does not cover it: that deadline''s letter is owed'
);
select is(
  public.dispatch_handed_off_since('00000000-0000-4000-8000-0000000000b1', '2026-09-20 10:00:00+00'),
  false,
  'a hand-off not yet drained has told nobody, so the sweep''s letter stands'
);
select is(
  public.dispatch_handed_off_since('00000000-0000-4000-8000-0000000000c1', '2026-09-20 10:00:00+00'),
  false,
  'only a hand-off counts, not any other event on the plan'
);
select is(
  public.dispatch_handed_off_since('00000000-0000-4000-8000-0000000000d1', '2026-09-20 10:00:00+00'),
  false,
  'and a plan with no events at all is not handed on'
);

select * from finish();
rollback;
