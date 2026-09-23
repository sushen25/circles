import { RemoveMemberRequest, type RemoveMemberResponse } from '@circles/contracts';

import { recalculateAfterWriting } from '../_shared/engine.ts';
import { jsonHandler } from '../_shared/http.ts';

/**
 * The owner takes somebody out of the circle (spec §5.2, §4.5; S1-23).
 *
 * `public.remove_member` decides whether — the owner's alone, never the owner
 * themselves, only somebody active — and the row trigger decides what follows:
 * access gone with the statement, their answers to plans still asking deleted,
 * those plans' input versions bumped so no set that counted them can be
 * confirmed, and `circles.member_removed` in the outbox.
 *
 * What is left is the recalculation, which runs here in the same request for
 * the reason an answer's does (ADR 0018): the organiser should see the options
 * without them the next time they look, not a minute later. Through the service
 * client, because the engine reads every member's answers. A failure there
 * cannot fail this request — the removal is committed — so each plan that could
 * not be recalculated now is left for `recalculate-candidates` and the stale
 * set is refused by `confirm` in the meantime.
 */
Deno.serve(
  jsonHandler({
    name: 'remove-member',
    schema: RemoveMemberRequest,
    handle: async ({ body, caller, service, requestId }): Promise<RemoveMemberResponse> => {
      const { data, error } = await caller.rpc('remove_member', {
        p_circle_id: body.circle_id,
        p_user_id: body.user_id,
      });
      if (error !== null) throw error;

      const stale = (data ?? []) as string[];
      for (const planId of stale) {
        await recalculateAfterWriting(service, planId, requestId);
      }

      return { ok: true, affected_plans: stale.length };
    },
  }),
);
