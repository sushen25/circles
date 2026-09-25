import { NUDGE_MOMENTS, isPlanBoundMoment } from '@circles/domain';
import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `record-nudge` — a conversion prompt, asked about before it is shown and told
 * what was done with it (spec §5.11, S2-07).
 *
 * **Without `answer` it is a question**: may this prompt be shown? The server
 * runs `nudgeEligibility` over the caller's `nudge_states` and, if the answer
 * is yes, records it as shown in the same request — so two devices cannot both
 * be told yes for one moment and plan. `suppressed: true` means do not show it,
 * and nothing was written.
 *
 * **With `answer`** it records a tap or a "not now" on a prompt that was shown.
 * Never suppressed: the prompt was on screen, and what the person did with it
 * is what the 30-day back-off counts.
 *
 * `plan_id` is required for every moment but the organiser gate
 * (`isPlanBoundMoment`), and refused for that one, so the row has the shape
 * `nudge_states_plan_shape` holds it to before it gets there.
 *
 * Reasons it can refuse: `not_a_member` (the plan is not in one of the
 * caller's circles).
 */
export const NudgeMomentSchema = z.enum(NUDGE_MOMENTS);

export const RecordNudgeRequest = Mutation.extend({
  moment: NudgeMomentSchema,
  plan_id: PlanId.optional(),
  answer: z.enum(['dismissed', 'tapped']).optional(),
}).refine((body) => isPlanBoundMoment(body.moment) === (body.plan_id !== undefined), {
  message: 'plan_id goes with every moment but organiser_gate, and never with that one',
  path: ['plan_id'],
});
export type RecordNudgeRequest = z.infer<typeof RecordNudgeRequest>;

/** Why a prompt was not shown. Words for a log and a test, never for a screen. */
export const NudgeSkipReason = z.enum([
  'installed',
  'already_saved',
  'needs_plan',
  'already_shown',
  'session_cap',
  'backed_off',
  'not_the_moment',
]);

export const RecordNudgeResponse = z.object({
  suppressed: z.boolean(),
  reason: NudgeSkipReason.optional(),
});
export type RecordNudgeResponse = z.infer<typeof RecordNudgeResponse>;
