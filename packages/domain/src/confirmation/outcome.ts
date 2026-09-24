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
import { addDays } from '../shared/local-date.js';
import { type Zone, fromLocal, toLocal } from '../shared/zone.js';
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

export type OutcomeErrorCode =
  ConfirmErrorCode | 'confirmation_not_active' | 'stale_confirmation' | 'outcome_too_early';

export type OutcomeError = Omit<ConfirmError, 'code'> & { readonly code: OutcomeErrorCode };

export type OutcomeReported = {
  readonly report: OutcomeReport;
  /** The confirmation, closed. Its time and available set are untouched. */
  readonly confirmation: Confirmation;
  /** The plan in its `completed` state, from the state machine. */
  readonly plan: Plan;
};

/**
 * Nine the next morning, where the reader is — when "did it happen?" is asked
 * (spec §5.10, §5.8). The same instant for the email the dispatcher sends and
 * for the question circle home puts to the reader, so neither asks before the
 * other would.
 *
 * Asking is not the same as allowing: an answer is taken from the moment the
 * meetup ends (`reportOutcome`, `updateAttendance`). This is only when the
 * product brings the question up of its own accord.
 */
export function morningAfter(end: Instant, where: Zone): Instant {
  return fromLocal(addDays(toLocal(end, where).date, 1), 9 * 60, where);
}

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
  // The plan's *current* revision, not merely its plan. A reopen bumps the
  // revision and supersedes the old confirmation; if the two ever come apart,
  // completing revision 2 with revision 1's evening would record a time that
  // was explicitly abandoned.
  if (confirmation.revision !== plan.revision) return fail('stale_confirmation');
  // Reporting on a superseded confirmation would attach an outcome to a time
  // that was replaced — and, through `lastMetAtAfter`, could move `lastMetAt`
  // to an evening the circle explicitly abandoned.
  if (confirmation.status !== 'active') return fail('confirmation_not_active');
  // "The morning after a confirmed meetup" (spec §5.10). Asked any earlier, the
  // question has no answer yet — and `happened` would set the circle's
  // `lastMetAt` to an instant that has not arrived, which cadence then reads.
  // Hiding the button is the client's job; refusing is this module's.
  if (now < confirmation.candidate.end) return fail('outcome_too_early');
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
/**
 * The rule itself, separated from the rows it is usually read off.
 *
 * The server cannot count the rows: `attendance_select_member` shows a
 * retrospective answer only to the person who gave it, deliberately — "nobody is
 * told who came" (spec §5.10) — so an organiser reading the table sees none of
 * the `was_there` rows that would corroborate them. The count comes from a
 * definer function instead, and this is what turns it into the word, so the
 * metric and the screen cannot disagree about what corroboration means.
 */
export function corroborationOf(outcome: Outcome, someoneElseWasThere: boolean): Corroboration {
  // Only `happened` can be corroborated: there is nothing for a second person
  // to confirm about a cancellation, and "corroborated not sure" is not a
  // sentence.
  if (outcome !== 'happened') return 'reported';
  return someoneElseWasThere ? 'corroborated' : 'reported';
}

export function corroboration(
  report: OutcomeReport,
  attendances: readonly Attendance[],
): Corroboration {
  if (report.outcome !== 'happened') return 'reported';
  // Scoped to the confirmation being reported on. A `was_there` from another
  // meetup is somebody confirming a different evening, and counting it would
  // make the corroborated figure — the evidence for the north-star metric —
  // quietly wrong in the direction that flatters it.
  const corroborated = attendances.some(
    (a) =>
      a.confirmationId === report.confirmationId &&
      a.status === 'was_there' &&
      a.userId !== report.reportedBy,
  );
  return corroborationOf(report.outcome, corroborated);
}
