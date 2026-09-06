import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Mutation } from './shared.js';

/** `answer-interest` — Record interest in a quiet ask and evaluate the threshold under a row lock, so it transitions exactly once. */
export const AnswerInterestRequest = Mutation.extend({ plan_id: PlanId, interested: z.boolean() });
export type AnswerInterestRequest = z.infer<typeof AnswerInterestRequest>;

export const AnswerInterestResponse = z.object({ threshold_reached: z.boolean() });
export type AnswerInterestResponse = z.infer<typeof AnswerInterestResponse>;
