-- ---------------------------------------------------------------------------
-- The two facts a quiet-ask message needs to find its audience, and only for
-- the kind being addressed (S1-20's note on SUS-50).
--
-- `dispatch_context` deliberately carries neither: it is loaded for every
-- plan every run, and a value that holds the initiator is a value that can end
-- up somewhere it should not. This is read by the drain only when an intent's
-- kind is one of the four that need it, merged into that one eligibility
-- question, and dropped:
--
--   * `quiet_ask` — the initiator, to leave them out of the prompt;
--   * `threshold_initiator`, `quiet_expired` — the initiator, who is the
--     audience;
--   * `threshold_keen` — the keen members, and the initiator, who has their
--     own message and is left out of this one.
--
-- Any other kind gets nothing. The ids go into `recipientsFor` and come out as
-- recipients; a job is keyed on its recipient, so for `threshold_initiator`
-- and `quiet_expired` the row names the initiator's contact — which is fine,
-- because that row is theirs — and nothing else carries it: not a payload, not
-- a log line, not another job.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_quiet_audience(p_plan_id uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'initiator_user_id', case
      when p_kind in ('quiet_ask', 'threshold_initiator', 'threshold_keen', 'quiet_expired') then (
        select pi.initiator_user_id from private.plan_initiators pi
        join public.plans p on p.id = pi.plan_id
        where pi.plan_id = p_plan_id and p.mode = 'quiet'
      )
    end,
    'keen_user_ids', case
      when p_kind = 'threshold_keen' then coalesce((
        select jsonb_agg(i.user_id order by i.user_id) from private.plan_interest i
        join public.plans p on p.id = i.plan_id
        where i.plan_id = p_plan_id and p.mode = 'quiet' and i.response = 'keen'
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  );
$$;

comment on function public.dispatch_quiet_audience(uuid, text) is
  'For one quiet-ask notification kind, the initiator and/or keen member ids its audience rule needs, and nothing for any other kind. Never logged, never written into a job. Service role only (S2-02).';

revoke all on function public.dispatch_quiet_audience(uuid, text) from public;
revoke all on function public.dispatch_quiet_audience(uuid, text) from anon, authenticated;
grant execute on function public.dispatch_quiet_audience(uuid, text) to service_role;
