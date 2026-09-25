import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `answer-interest` — **I'm keen** or **Not this time** on a quiet ask (spec
 * §5.4.2). Recorded privately, and the threshold evaluated under the plan's
 * row lock in the same transaction, so it opens exactly once however many
 * answers arrive together.
 *
 * Any active member may answer, a guest included. The same answer twice is not
 * an error, and a different one replaces it while the ask is still asking.
 *
 * Refusals: `interest_closed` (opened, withdrawn, expired, or past its stop
 * time), `initiator_is_keen` (the initiator stays keen; to stop, they withdraw
 * through `cancel-plan`), `not_quiet`, `plan_not_found`.
 */
export const AnswerInterestRequest = Mutation.extend({ plan_id: PlanId, interested: z.boolean() });
export type AnswerInterestRequest = z.infer<typeof AnswerInterestRequest>;

/**
 * Whether this answer opened the ask, and nothing else. **Never a count**:
 * `false` means "not open yet" whether one more answer is needed or ten, or the
 * ask is held beside a plan already finding a time (ADR 0035), so two answers
 * side by side cannot be differenced to find who answered between them.
 */
export const AnswerInterestResponse = z.object({ threshold_reached: z.boolean() });
export type AnswerInterestResponse = z.infer<typeof AnswerInterestResponse>;
