import { z } from 'zod';

import { PlanId } from '../ids.js';
import { CandidateSummary } from './submit-availability.js';

/**
 * `recalculate-candidates` — run the engine for a plan and store what it found.
 *
 * **Internal** (architecture §9.1): the bearer is `CRON_SECRET`, the same way
 * `process-scheduled-jobs` is reached, and no member calls it. Every answer
 * already recalculates inline in `submit-availability`, so this exists for the
 * cases a member's request cannot cover — a deadline passing, a recalculation
 * that lost its compare-and-set, a plan whose inputs changed without anybody
 * answering.
 *
 * No `input_version` in the request, though an earlier draft had one. The
 * version this runs against is the one it reads under the plan's lock; a caller
 * who could name it could pin a recalculation to a version the plan has left,
 * which is the exact staleness the whole design is built to notice.
 */
export const RecalculateCandidatesRequest = z.object({
  plan_id: PlanId,
});
export type RecalculateCandidatesRequest = z.infer<typeof RecalculateCandidatesRequest>;

export const RecalculateCandidatesResponse = CandidateSummary;
export type RecalculateCandidatesResponse = z.infer<typeof RecalculateCandidatesResponse>;
