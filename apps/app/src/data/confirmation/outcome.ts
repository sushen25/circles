import {
  ReportOutcomeRequest,
  ReportOutcomeResponse,
  type IdempotencyKey,
} from '@circles/contracts';
import type { Outcome } from '@circles/domain';

import { invokeFunction } from '../functions';

/**
 * The morning after, both halves, through `report-outcome` (spec §5.10, S1-17).
 *
 * **One door for the retrospective answers.** "I was there" and "I couldn't
 * make it" go through the function rather than through `setAttendance`, even
 * though both end as the same write to `attendance`: the function answers with
 * the evidence — whether anybody has corroborated the organiser, and how many
 * have said either way — counted by `confirmation_evidence` where the rows can
 * be seen. A client that wrote the row itself could only count its own, because
 * `attendance_select_member` shows a retrospective answer to its subject alone
 * ("nobody is told who came"). `setAttendance` stays the before-the-meetup
 * correction and nothing else.
 *
 * The key is the caller's: one per answer, reused for a retry of that answer
 * (ADR 0016), so a tap that timed out and is tried again is answered from the
 * record rather than counted twice.
 */

export type OutcomeEvidence = ReportOutcomeResponse;

export type RetrospectiveAnswer = 'was_there' | 'missed';

export async function reportOutcome(input: {
  confirmationId: string;
  outcome: Outcome;
  /** "Did the plan change outside the app?" — the survey's own answer (§5.10). */
  movedOutside: boolean;
  /** One line for the circle's record. Blank is no note. */
  note?: string | undefined;
  key: IdempotencyKey;
}): Promise<OutcomeEvidence> {
  const note = input.note?.trim();
  return invokeFunction(
    'report-outcome',
    ReportOutcomeRequest.parse({
      idempotency_key: input.key,
      confirmation_id: input.confirmationId,
      outcome: input.outcome,
      // Its own question, not read off the outcome: a catch-up that happened
      // at a time the chat settled on changed outside the app too (review
      // round 2). It is the H2 evidence, and the contract requires it.
      moved_outside: input.movedOutside,
      note: note === undefined || note === '' ? undefined : note,
    }),
    ReportOutcomeResponse,
  );
}

export async function reportAttendance(input: {
  confirmationId: string;
  attendance: RetrospectiveAnswer;
  key: IdempotencyKey;
}): Promise<OutcomeEvidence> {
  return invokeFunction(
    'report-outcome',
    ReportOutcomeRequest.parse({
      idempotency_key: input.key,
      confirmation_id: input.confirmationId,
      attendance: input.attendance,
    }),
    ReportOutcomeResponse,
  );
}
