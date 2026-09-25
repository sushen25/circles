import { type QuietView, QuietViewRequest, type QuietViewResponse } from '@circles/contracts';
import { type Interest, type QuietView as DomainView, quietView } from '@circles/domain';

import { jsonHandler } from '../_shared/http.ts';
import { fromInstant, now } from '../_shared/moment.ts';
import { quietPlanOf } from './plan.ts';

/**
 * What the caller may see of a quiet plan (spec §5.4): `quietView`, built on
 * the server for this viewer and returned alone.
 *
 * Three of its inputs live in `private` and are read with the service role for
 * the verified caller only (`quiet_viewer_facts`): whether they started the
 * ask, their own answer, and whether an expired ask had opened. **None of them
 * leaves this function** — the response is the domain's view, whose keys a
 * domain test enumerates, and the contract's schema is strict (review round 1).
 * Everything else is read through the caller's own client, so RLS answers
 * "may this person see this plan?" first.
 *
 * Nothing is logged but what the wrapper logs, which is never the caller.
 */
Deno.serve(
  jsonHandler({
    name: 'quiet-view',
    schema: QuietViewRequest,
    handle: async ({ body, actor, caller, service }): Promise<QuietViewResponse> => {
      const { data: row, error } = await caller
        .from('plans')
        .select('*')
        .eq('id', body.plan_id)
        .maybeSingle();
      if (error !== null) throw error;
      if (row === null || row.mode !== 'quiet') return { view: null };

      const { data: facts, error: factsError } = await service.rpc('quiet_viewer_facts', {
        p_plan_id: body.plan_id,
        p_user_id: actor.userId,
      });
      if (factsError !== null) throw factsError;
      // Not an active member of the circle, however RLS answered a moment ago.
      if (facts === null) return { view: null };
      const mine = facts as {
        is_initiator: boolean;
        my_answer: Interest | null;
        ever_opened: boolean | null;
      };

      const [circle, counts, organiser] = await Promise.all([
        caller.from('circles').select('owner_user_id').eq('id', row.circle_id).maybeSingle(),
        caller
          .from('plan_interest_counts')
          .select('keen_count')
          .eq('plan_id', row.id)
          .maybeSingle(),
        row.organiser_user_id === null
          ? Promise.resolve({ data: null, error: null })
          : caller
              .from('circle_members')
              .select('display_name_snapshot')
              .eq('circle_id', row.circle_id)
              .eq('user_id', row.organiser_user_id)
              .maybeSingle(),
      ]);
      for (const read of [circle, counts, organiser]) if (read.error !== null) throw read.error;

      const view = quietView(
        quietPlanOf(row),
        {
          userId: actor.userId as never,
          isMember: true,
          isPermanent: !actor.isAnonymous,
          isOwner: circle.data?.owner_user_id === actor.userId,
          isInitiator: mine.is_initiator,
          myAnswer: mine.my_answer,
        },
        {
          now: now(),
          keenCount: counts.data?.keen_count ?? null,
          organiserName:
            (organiser.data as { display_name_snapshot?: string } | null)?.display_name_snapshot ??
            null,
          ...(mine.ever_opened === null ? {} : { everOpened: mine.ever_opened }),
        },
      );
      return { view: view === undefined ? null : wire(view) };
    },
  }),
);

/** The domain's view in the wire's words. Exhaustive, so a new key is a type error. */
function wire(view: DomainView): QuietView {
  switch (view.phase) {
    case 'seeking':
      return {
        phase: 'seeking',
        closes_at: fromInstant(view.closesAt) as Extract<
          QuietView,
          { phase: 'seeking' }
        >['closes_at'],
        threshold: view.threshold,
        answered_by_me: view.answeredByMe,
        may_withdraw: view.mayWithdraw,
      };
    case 'opened':
      return {
        phase: 'opened',
        keen_count: view.keenCount,
        organiser: view.organiser,
        may_take_role: view.mayTakeRole,
      };
    case 'closed':
      return { phase: 'closed', show_closed_notice: view.showClosedNotice };
  }
}
