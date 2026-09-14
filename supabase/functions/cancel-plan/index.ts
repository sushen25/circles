import { CancelPlanRequest, type CancelPlanResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';

/**
 * Calling it off (spec §5.7).
 *
 * As thin as an endpoint gets, and deliberately: every decision belongs to
 * `planning.transition_plan` — that only the organiser may, that a finished plan
 * cannot be cancelled twice, which of the two cancellation events goes out, and
 * that a confirmed meetup's confirmation is superseded along with it. The note
 * is the one thing this carries, and it is carried to the *row*, not to the
 * event: an outbox payload may not hold somebody's words.
 */
Deno.serve(
  jsonHandler({
    name: 'cancel-plan',
    schema: CancelPlanRequest,
    handle: async ({ body, caller }): Promise<CancelPlanResponse> => {
      const { error } = await caller.rpc('cancel_plan', {
        p_plan_id: body.plan_id,
        p_note: body.note ?? null,
      });
      if (error !== null) throw error;

      return { ok: true };
    },
  }),
);
