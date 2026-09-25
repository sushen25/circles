-- ---------------------------------------------------------------------------
-- What one viewer may know about a quiet ask that only the private tables
-- hold — about themselves, and only themselves (spec §5.4, `quietView`).
--
-- `quietView` in `packages/domain/src/planning/quiet-view.ts` is built per
-- viewer, for that viewer, from `QuietViewer` and `QuietFacts`. Everything it
-- needs is on the plan row, in `plan_interest_counts` or in `circle_members`,
-- except three facts that live in `private`, which no client may read:
--
--   * `is_initiator` — whether *the caller* started it. Two things on their
--     own screen turn on it: withdrawing, and the closing notice.
--   * `my_answer` — *the caller's* own answer, or null. `quietView` turns it
--     into "answered" while the ask is seeking (never *what*, on screen) and
--     into `mayTakeRole` once it has opened.
--   * `ever_opened` — for an `expired` quiet plan, whether it had crossed its
--     threshold first (SUS-49 note 11): an ask that opened and later ran past
--     its last start did not "close quietly". Read from the outbox: `true` if
--     the crossing was announced, `false` if the expiry was announced from
--     `seeking`, null when neither is there any more (retention keeps thirty
--     days) — and `quietView` shows no notice for unknown.
--
-- Never about anybody else, and never for a plan the caller cannot see: a
-- non-member gets nothing, which is the same nothing a named plan gets. Build
-- a view per viewer and never ship one computed for somebody else — that is
-- the one way `mayWithdraw` becomes an initiator flag.
-- ---------------------------------------------------------------------------

create or replace function public.my_quiet_ask(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_initiator', exists (
      select 1 from private.plan_initiators pi
      where pi.plan_id = p.id and pi.initiator_user_id = (select auth.uid())
    ),
    'my_answer', (
      select i.response from private.plan_interest i
      where i.plan_id = p.id and i.user_id = (select auth.uid())
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
    and public.auth_is_member(p.circle_id);
$$;

comment on function public.my_quiet_ask(uuid) is
  'For the calling member only: whether they started this quiet ask, their own answer, and for an expired one whether it had opened. Null for a named plan or a plan the caller cannot see (S2-02).';

revoke all on function public.my_quiet_ask(uuid) from public;
revoke all on function public.my_quiet_ask(uuid) from anon, authenticated;
grant execute on function public.my_quiet_ask(uuid) to authenticated;
