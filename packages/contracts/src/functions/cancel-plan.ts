import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Accepted, Mutation } from './shared.js';

/**
 * `cancel-plan` — a final state, with something to say about it.
 *
 * From `confirmed` this is "Thursday is off" and goes to everyone who put it in
 * a calendar; from `collecting` it is withdrawing an ask. The database picks
 * which event to emit from the state it was in (`planning.event_for`), so the
 * caller does not say.
 */
export const CancelPlanRequest = Mutation.extend({
  plan_id: PlanId,
  /**
   * The organiser's own words, delivered in the cancellation notice.
   *
   * A note is *content*: it is stored on the plan and passed to the notification
   * pipeline, and it never reaches a log or an analytics payload
   * (non-negotiable 8). `jobs.carries_content` refuses it in an outbox payload,
   * which is why the event carries the plan and the pipeline reads the note from
   * the row.
   */
  note: z.string().max(280).optional(),
});
export type CancelPlanRequest = z.infer<typeof CancelPlanRequest>;

export const CancelPlanResponse = Accepted;
export type CancelPlanResponse = z.infer<typeof CancelPlanResponse>;
