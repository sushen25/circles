import { LeaveCircleRequest, type LeaveCircleResponse } from '@circles/contracts';

import { recalculateAfterWriting } from '../_shared/engine.ts';
import { jsonHandler } from '../_shared/http.ts';

/**
 * A member, guests included, takes themselves out of a circle (spec §4.5, §13;
 * S4-05, ADR 0083). The owner's Remove, done by the person it is done to.
 *
 * `public.leave_circle` decides whether (an active member, and not the owner)
 * and the row trigger decides what follows, exactly as for `remove-member`:
 * access ends with the statement, their answers to plans still asking go, and
 * those plans' input versions are bumped. What is left is the recalculation,
 * run here in the same request (ADR 0018) through the service client because
 * the engine reads every member's answers; a failure there cannot fail the
 * request, the leaving is committed, and `confirm` refuses the stale set.
 */
Deno.serve(
  jsonHandler({
    name: 'leave-circle',
    schema: LeaveCircleRequest,
    handle: async ({ body, caller, service, requestId }): Promise<LeaveCircleResponse> => {
      const { data, error } = await caller.rpc('leave_circle', { p_circle_id: body.circle_id });
      if (error !== null) throw error;

      const stale = (data ?? []) as string[];
      for (const planId of stale) {
        await recalculateAfterWriting(service, planId, requestId);
      }

      return { ok: true, affected_plans: stale.length };
    },
  }),
);
