import {
  RecalculateCandidatesRequest,
  type RecalculateCandidatesResponse,
} from '@circles/contracts';

import { recalculate } from '../_shared/engine.ts';
import { internalHandler } from '../_shared/internal.ts';

/**
 * The engine, for the cases nobody's request covers (architecture §9.1).
 *
 * Every answer already recalculates inline, in the request that made it, so this
 * is not how candidates normally appear. It is how they appear when there is no
 * request to attach to: a deadline passing, a member being removed, a
 * recalculation that lost its compare-and-set to a simultaneous answer and left
 * the plan a version ahead of its set.
 *
 * **Internal**, which §9.1 says and this enforces: the bearer is `CRON_SECRET`,
 * the same value `jobs.invoke_process_scheduled_jobs()` sends. No member calls
 * it — not because recalculating is dangerous, but because it is the one
 * endpoint whose cost is unbounded by anything the caller has done, and a member
 * who wants fresh candidates has a cheaper way to get them: answer, or read the
 * set that is there.
 *
 * It takes a plan and no version. The version it runs against is the one it
 * reads; a caller who could name one could pin a recalculation to a version the
 * plan has already left, which is the exact staleness this whole path exists to
 * notice.
 */
Deno.serve(
  internalHandler({
    name: 'recalculate-candidates',
    schema: RecalculateCandidatesRequest,
    handle: async ({ body, service, requestId }): Promise<RecalculateCandidatesResponse> =>
      recalculate(service, body.plan_id, requestId),
  }),
);
