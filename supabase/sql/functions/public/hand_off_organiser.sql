-- ---------------------------------------------------------------------------
-- "Hand this to someone else" (spec §5.7, §9: "the organiser wants out").
--
-- The organiser gives the plan to another member, and that is one write with
-- two halves, which is why it is one function rather than a transition and a
-- clean-up somebody might forget:
--
--   * **The transition.** `planning.transition_plan(…, 'hand_off', …)` holds
--     every rule: only the organiser may (`organiser`), only from a plan with
--     something left to decide (`collecting`, `ready`), and only to an active
--     member the plan is asking, with a saved place, who is not the organiser
--     already (`hand_off_target` — spec §8.2's "organiser roles belong to
--     saved-place identities only"). It emits `planning.organiser_changed`, which the drain
--     turns into the new organiser's letter.
--   * **The letters already written to the old one.** `dispatch_context` reads
--     `plans.organiser_user_id`, so the organiser kinds go to the new organiser
--     from the next tick. A job already in the table names the old organiser's
--     contact and would still be sent to them: a `replies_closed` held
--     overnight by quiet hours, an `options_ready` retrying. They are skipped
--     here, in the transaction that moves the plan — the pattern of
--     `dispatch_cancel_pending`, keyed by the person rather than the revision.
--     The sender checks again at send time (`handedOver` in the dispatcher), so
--     a job the drain writes in the same tick is caught too.
--
-- The kinds are the three whose audience is `organiser` in the domain's
-- `NOTIFICATION_KINDS`: `about_time` is the other organiser-addressed kind and
-- belongs to a circle, not to this plan.
--
-- `auth.uid()` is the actor, never an argument, for the reason `revise_plan`
-- gives: a client-callable function that took one would let a caller name
-- somebody else.
-- ---------------------------------------------------------------------------

create or replace function public.hand_off_organiser(p_plan_id uuid, p_to_user_id uuid)
returns public.plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  handed public.plans;
begin
  if caller is null then
    raise exception 'hand_off_organiser requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;
  if p_to_user_id is null then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  handed := planning.transition_plan(
    p_plan_id, 'hand_off', caller, jsonb_build_object('organiser_user_id', p_to_user_id));

  update jobs.notification_jobs j
  set status = 'skipped', last_error = 'organiser_changed', updated_at = now()
  where j.plan_id = handed.id
    and j.status = 'scheduled'
    and j.kind in ('options_ready', 'replies_closed', 'did_it_happen')
    and (
      j.user_id = caller
      or exists (
        select 1 from private.email_contacts c where c.id = j.contact_id and c.user_id = caller
      )
    );

  return handed;
end;
$$;

comment on function public.hand_off_organiser(uuid, uuid) is
  'Gives the calling organiser''s plan to another active, saved-place member through planning.transition_plan, and skips the organiser letters already queued for the caller, in one transaction (S2-05).';

revoke all on function public.hand_off_organiser(uuid, uuid) from public;
revoke all on function public.hand_off_organiser(uuid, uuid) from anon, authenticated;
grant execute on function public.hand_off_organiser(uuid, uuid) to authenticated;
