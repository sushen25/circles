import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Mutation, Accepted } from './shared.js';

/** `report-outcome` — Organiser reports the outcome; a member may report their own attendance. */
export const ReportOutcomeRequest = Mutation.extend({
  plan_id: PlanId,
  outcome: z.enum(['happened', 'did_not_happen', 'unsure']).optional(),
  attended: z.boolean().optional(),
});
export type ReportOutcomeRequest = z.infer<typeof ReportOutcomeRequest>;

export const ReportOutcomeResponse = Accepted;
export type ReportOutcomeResponse = z.infer<typeof ReportOutcomeResponse>;
