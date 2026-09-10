/**
 * "Did this catch-up happen?" (spec §5.10).
 *
 * The screen says it plainly: "It just sets when the circle last got together.
 * Nobody is scored, and nobody is told who came." Everything here is built to
 * keep that true — one field moves, and only one answer moves it.
 */

import type { Circle } from '../circles/types.js';
import { canTransition } from '../planning/state-machine.js';
import type { Actor } from '../planning/state-machine.js';
import type { Plan } from '../planning/types.js';
import { type Instant, latest } from '../shared/instant.js';
import { type Result, err, ok } from '../shared/result.js';
import type { ConfirmError, ConfirmErrorCode } from './confirm.js';
import {
  type Attendance,
  type Confirmation,
  type ConfirmationStatus,
  type Corroboration,
  NOTE_MAX_LENGTH,
  type Outcome,
  type OutcomeReport,
} from './types.js';

export type ReportOutcomeRequest = {
  readonly plan: Plan;
  readonly confirmation: Confirmation;
  readonly outcome: Outcome;
  readonly note?: string | undefined;
  readonly actor: Actor;
  readonly now: Instant;
};

export type OutcomeErrorCode = ConfirmErrorCode | 'confirmation_not_active';

export type OutcomeError = Omit<ConfirmError, 'code'> & { readonly code: OutcomeErrorCode };

export type OutcomeReported = {
  readonly report: OutcomeReport;
  /** The confirmation, closed. Its time and available set are untouched. */
  readonly confirmation: Confirmation;
  /** The plan in its `completed` state, from the state machine. */
  readonly plan: Plan;
};

/**
 * `cancelled` is the one outcome that says the meetup did not take place at
 * all, so the confirmation ends cancelled. The other three all describe a
 * finished attempt — it happened, it happened elsewhere, or nobody is sure —
 * and a finished attempt is `completed`. The distinction is the record's, not a
 * judgement: `moved_outside` is "neither failure nor success" (spec §9).
 */
export function statusAfter(outcome: Outcome): ConfirmationStatus {
  return outcome === 'cancelled' ? 'cancelled' : 'completed';
}

export function reportOutcome(
  request: ReportOutcomeRequest,
): Result<OutcomeError, OutcomeReported> {
  const { plan, confirmation, outcome, note, actor, now } = request;
  const fail = (code: OutcomeErrorCode): Result<OutcomeError, OutcomeReported> =>
    err({ code, planId: plan.id, revision: plan.revision });

  const transition = canTransition(plan, 'report_outcome', { actor });
  if (!transition.ok) return fail(transition.error.code);

  if (confirmation.planId !== plan.id) return fail('wrong_plan');
  // Reporting on a superseded confirmation would attach an outcome to a time
  // that was replaced — and, through `lastMetAtAfter`, could move `lastMetAt`
  // to an evening the circle explicitly abandoned.
  if (confirmation.status !== 'active') return fail('confirmation_not_active');
  if ((note?.length ?? 0) > NOTE_MAX_LENGTH) return fail('note_too_long');

  return ok({
    report: {
      confirmationId: confirmation.id,
      circleId: plan.circleId,
      outcome,
      reportedBy: actor.userId as OutcomeReport['reportedBy'],
      note,
      reportedAt: now,
    },
    confirmation: { ...confirmation, status: statusAfter(outcome) },
    plan: transition.value,
  });
}

/**
 * The circle's `lastMetAt` after this outcome — **only** `happened` moves it,
 * and it moves to the time the circle actually met rather than to now.
 *
 * It also never moves backwards. An outcome can be reported late, and a circle
 * that has met again since must not be told it last met a fortnight ago because
 * somebody finally answered an old email. Cadence is built on this field
 * (spec §5.9), so a backwards step would make the circle look due when it is not.
 */
export function lastMetAtAfter(
  circle: Circle,
  confirmation: Confirmation,
  outcome: Outcome,
): Instant | undefined {
  if (outcome !== 'happened') return circle.lastMetAt;
  const met = confirmation.candidate.start;
  return circle.lastMetAt === undefined ? met : latest(circle.lastMetAt, met);
}

/**
 * Whether anyone other than the reporter says they were there (spec §5.10).
 *
 * Only `happened` can be corroborated: there is nothing for a second person to
 * confirm about a cancellation, and "corroborated not sure" is not a sentence.
 */
export function corroboration(
  report: OutcomeReport,
  attendances: readonly Attendance[],
): Corroboration {
  if (report.outcome !== 'happened') return 'reported';
  const corroborated = attendances.some(
    (a) => a.status === 'was_there' && a.userId !== report.reportedBy,
  );
  return corroborated ? 'corroborated' : 'reported';
}
