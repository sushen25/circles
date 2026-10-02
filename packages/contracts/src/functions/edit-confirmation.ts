import { NOTE_MAX_LENGTH, PLACE_NAME_MAX_LENGTH, isLink } from '@circles/domain';
import { z } from 'zod';

import { ConfirmationId, PlanId, UserId } from '../ids.js';
import { Instant } from '../time.js';
import { Mutation } from './shared.js';

/**
 * `edit-confirmation` — the organiser edits a locked-in plan without asking
 * anybody again ([ADR 0050](../../../../docs/decisions/0050-the-organiser-sets-the-final-plan.md)).
 *
 * "Edit this plan" on the confirmed screen. Three things can change:
 *
 * - **the place or the note alone**: the confirmation is updated in place, nobody's
 *   status changes and nobody is emailed;
 * - **the time**: a move. The confirmation is superseded for the reason `move` and a
 *   new one is written in the same revision; who is going is derived again, and the
 *   plan's members are told once;
 * - neither asks anybody to answer again. That is "Ask for new times", `revise-plan`'s
 *   neighbour, and it is not here.
 *
 * The place and note are said **whole**: what the screen now shows, with `null`
 * clearing one and a missing field clearing it too. A save that changes nothing is
 * refused (`nothing_to_change`), so a repeated request is not a second move.
 */
export const EditConfirmationRequest = Mutation.extend({
  plan_id: PlanId,
  /** The new time, both ends, or neither to leave it where it is. */
  starts_at: Instant.optional(),
  ends_at: Instant.optional(),
  /**
   * The plan's input version as `stretch_availability` returned it with the names
   * the organiser was shown. Required for a move, for the reason `confirm-meetup`
   * names it for an own time; a place or note alone freezes no names and does not
   * need it.
   */
  expected_input_version: z.int().min(1).optional(),
  place_name: z.string().trim().min(1).max(PLACE_NAME_MAX_LENGTH).nullish(),
  place_url: z.string().trim().max(2048).refine(isLink, 'not a link').nullish(),
  note: z.string().trim().min(1).max(NOTE_MAX_LENGTH).nullish(),
})
  .strict()
  .refine((body) => (body.starts_at === undefined) === (body.ends_at === undefined), {
    message: 'a time has two ends',
    path: ['ends_at'],
  })
  .refine((body) => body.starts_at === undefined || body.expected_input_version !== undefined, {
    message: 'a move names the version of the names the organiser saw',
    path: ['expected_input_version'],
  });
export type EditConfirmationRequest = z.infer<typeof EditConfirmationRequest>;

export const EditConfirmationResponse = z.object({
  /** The active confirmation now: a new one after a move, the same one after an edit. */
  confirmation_id: ConfirmationId,
  starts_at: Instant,
  ends_at: Instant,
  /** Who is going, as it stands. After a move, derived again from this revision's answers. */
  going: z.array(UserId),
});
export type EditConfirmationResponse = z.infer<typeof EditConfirmationResponse>;
