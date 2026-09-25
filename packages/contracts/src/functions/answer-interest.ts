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
 * That the answer was recorded, and **nothing else** — not a count, and not
 * whether this answer was the one that opened the ask (review round 4).
 *
 * The response is kept against the caller in the idempotency record so that a
 * retry gets the same answer back, and "your answer opened it" beside a user
 * id says that person was keen. What the ask looks like now is `quiet-view`'s
 * to say, built for whoever asks, from facts that stay on the server.
 */
export const AnswerInterestResponse = z.object({ recorded: z.literal(true) });
export type AnswerInterestResponse = z.infer<typeof AnswerInterestResponse>;
