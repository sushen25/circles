import { ExtendDeadlineRequest, ExtendDeadlineResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';

/**
 * "Give it one more day" (spec §5.7).
 *
 * The new deadline is worked out in `public.extend_deadline`, under the plan's
 * lock and on the database's clock, rather than here: "a day from now" is only
 * a rule if one clock says what now is, and "once per revision" is only a rule
 * if the check and the write are one transaction. The client proposes nothing;
 * it asks for the day and is told when replies now close.
 *
 * No recalculation afterwards, unlike `revise-plan`: a deadline-only `adjust`
 * changes neither the quorum nor who is required, so the candidate set on offer
 * is exactly the one there was (ADR 0017).
 */
Deno.serve(
  jsonHandler({
    name: 'extend-deadline',
    schema: ExtendDeadlineRequest,
    handle: async ({ body, caller }): Promise<ExtendDeadlineResponse> => {
      const { data, error } = await caller.rpc('extend_deadline', { p_plan_id: body.plan_id });
      if (error !== null) throw error;

      return ExtendDeadlineResponse.parse({
        response_deadline: new Date(
          (data as { response_deadline: string }).response_deadline,
        ).toISOString(),
      });
    },
  }),
);
