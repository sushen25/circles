import { HandOffOrganiserRequest, type HandOffOrganiserResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';

/**
 * "Hand this to someone else" (spec §5.7, §9).
 *
 * As thin as `cancel-plan`, for the same reason: every decision is
 * `public.hand_off_organiser`'s — only the organiser, only while there is
 * something to decide, only to an active member with a saved place — and so is
 * the half nobody should be trusted to remember, taking back the letters
 * already queued for the person who just let go of the plan. One transaction,
 * so there is no moment at which the plan has a new organiser and the old one
 * is still about to be told replies have closed.
 *
 * The new organiser's letter is the dispatcher's: `planning.organiser_changed`
 * is drained on the next tick like every other event.
 */
Deno.serve(
  jsonHandler({
    name: 'hand-off-organiser',
    schema: HandOffOrganiserRequest,
    handle: async ({ body, caller }): Promise<HandOffOrganiserResponse> => {
      const { error } = await caller.rpc('hand_off_organiser', {
        p_plan_id: body.plan_id,
        p_to_user_id: body.to_user_id,
      });
      if (error !== null) throw error;

      return { ok: true };
    },
  }),
);
