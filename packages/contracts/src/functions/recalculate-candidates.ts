import { z } from 'zod';

import { PlanId, CandidateSetId } from '../ids.js';

/** `recalculate-candidates` — Internal. Runs the engine and persists only if the input version is still current. */
export const RecalculateCandidatesRequest = z.object({
  plan_id: PlanId,
  input_version: z.int().nonnegative(),
});
export type RecalculateCandidatesRequest = z.infer<typeof RecalculateCandidatesRequest>;

export const RecalculateCandidatesResponse = z.object({
  candidate_set_id: CandidateSetId.optional(),
  state: z.enum(['collecting', 'ready', 'no_quorum']),
});
export type RecalculateCandidatesResponse = z.infer<typeof RecalculateCandidatesResponse>;
