import { NOTE_MAX_LENGTH } from '@circles/domain';
import { z } from 'zod';

import { ConfirmationId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `report-outcome` — "Did this catch-up happen?", and "I was there".
 *
 * One endpoint and two different people (spec §5.10). The organiser answers for
 * the meetup: happened, cancelled, moved outside the app, not sure. Any member
 * answers for themselves: they were there, or they missed it. The two are never
 * the same request — an `outcome` is a statement about the evening and an
 * `attendance` is a statement about one person, and somebody who is both the
 * organiser and an attendee makes them one at a time.
 *
 * "Reported happened" is the organiser saying so; "corroborated happened" is at
 * least one other member confirming they were there (§11.1). Both come back, so
 * the screen can say which it is without a second read.
 */
export const ReportOutcomeRequest = Mutation.extend({
  confirmation_id: ConfirmationId,
  /**
   * The organiser's answer. The spec's four, not a rewording: "moved outside"
   * is "neither failure nor success" (§9) and "not sure" is a real answer that
   * deliberately moves nothing.
   */
  outcome: z.enum(['happened', 'cancelled', 'moved_outside', 'not_sure']).optional(),
  /** One line for the circle's record. Optional, and never shown as a score. */
  note: z.string().trim().min(1).max(NOTE_MAX_LENGTH).optional(),
  /** The second tap of the survey: "did the plan change outside the app?" (§5.10). */
  moved_outside: z.boolean().optional(),
  /**
   * A member's own answer, from circle home or the emailed link. Not `going` or
   * `cant`: those are about a meetup that has not happened yet and are an
   * ordinary write to `attendance` under RLS, with no endpoint (S1-10).
   */
  attendance: z.enum(['was_there', 'missed']).optional(),
})
  .refine((body) => (body.outcome === undefined) !== (body.attendance === undefined), {
    message: 'an outcome or an attendance, and not both',
  })
  .refine((body) => body.attendance === undefined || body.note === undefined, {
    message: 'the note belongs to the outcome, which is the organiser’s',
    path: ['note'],
  });
export type ReportOutcomeRequest = z.infer<typeof ReportOutcomeRequest>;

export const ReportOutcomeResponse = z.object({
  /**
   * Where the meetup stands as evidence: `reported` is the organiser's word for
   * it, `corroborated` is at least one other member saying they were there
   * (§11.1). Absent until the organiser has answered at all — a member's "I was
   * there" corroborates nothing on its own.
   */
  corroboration: z.enum(['reported', 'corroborated']).optional(),
  /** Who was there, as far as anybody has said. Counts, never a roll call. */
  was_there: z.int().nonnegative(),
  missed: z.int().nonnegative(),
});
export type ReportOutcomeResponse = z.infer<typeof ReportOutcomeResponse>;
