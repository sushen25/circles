-- ---------------------------------------------------------------------------
-- The three facts about one viewer of a quiet ask that only `private` holds,
-- for `quiet-view` to build that viewer's `quietView` with (spec §5.4).
--
-- `quietView` in `packages/domain/src/planning/quiet-view.ts` turns them into
-- what the viewer may see — "answered", never *what*; "may withdraw", never
-- "is the initiator" — and **the raw facts never leave the server** (review
-- round 1): this is the service role's, called by the Edge Function with the
-- verified caller's id, and the function returns the view and nothing else.
--
--   * `is_initiator` — whether this viewer started it;
--   * `my_answer` — this viewer's own answer, or null;
--   * `ever_opened` — for an `expired` quiet plan, whether it had crossed its
--     threshold first (SUS-49 note 11): an ask that opened and later ran past
--     its last start did not "close quietly". From the outbox: `true` if the
--     crossing was announced, `false` if the expiry was announced from
--     `seeking`, null when neither is there any more (retention keeps thirty
--     days), and `quietView` shows no notice for unknown.
--
-- Null for a named plan, or a viewer who is not an active member of its
-- circle.
-- ---------------------------------------------------------------------------

create or replace function public.quiet_viewer_facts(p_plan_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_initiator', exists (
      select 1 from private.plan_initiators pi
      where pi.plan_id = p.id and pi.initiator_user_id = p_user_id
    ),
    'my_answer', (
      select i.response from private.plan_interest i
      where i.plan_id = p.id and i.user_id = p_user_id
    ),
    'ever_opened', case
      when p.state <> 'expired' then null
      when exists (
        select 1 from jobs.outbox o
        where o.aggregate_id = p.id and o.event_name = 'planning.threshold_reached'
      ) then true
      when exists (
        select 1 from jobs.outbox o
        where o.aggregate_id = p.id and o.event_name = 'planning.plan_expired'
          and o.payload ->> 'from_state' = 'seeking'
      ) then false
      else null
    end
  )
  from public.plans p
  where p.id = p_plan_id
    and p.mode = 'quiet'
    and exists (
      select 1 from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = p_user_id and m.status = 'active'
    );
$$;

comment on function public.quiet_viewer_facts(uuid, uuid) is
  'For one viewer of a quiet ask: whether they started it, their own answer, and for an expired one whether it had opened — the inputs quietView needs from private. Never returned to a client. Service role only (S2-02).';

revoke all on function public.quiet_viewer_facts(uuid, uuid) from public;
revoke all on function public.quiet_viewer_facts(uuid, uuid) from anon, authenticated;
grant execute on function public.quiet_viewer_facts(uuid, uuid) to service_role;
