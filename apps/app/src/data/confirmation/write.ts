import {
  ConfirmMeetupRequest,
  ConfirmMeetupResponse,
  GenerateIcsRequest,
} from '@circles/contracts';

import { authClient } from '../auth/client';
import { FunctionError, invokeFunction, newIdempotencyKey, problemOf } from '../functions';

/**
 * The three things the confirmed flow writes or fetches (spec §5.7).
 *
 * Nothing here decides anything: `confirm-meetup` and the database decide
 * whether a time may be locked in, and `enforce_attendance_transition` decides
 * whether a member may change their answer. This is the door to each.
 */

export type ChasedAnswer = ConfirmMeetupRequest['chased_answer'];

export type ConfirmInput = {
  planId: string;
  /** The candidate's start instant, as ISO — its id (S1-16). */
  candidateId: string;
  /**
   * The `candidate_sets.id` the option on screen was read from. Required: it
   * is the freshness check. A mismatch comes back as `stale_candidates`, and
   * the answer to that is to read again and show it — never to resend with the
   * new id, which is the bug the check exists to catch.
   */
  expectedSetId: string;
  chasedAnswer: ChasedAnswer;
  placeName?: string | undefined;
  placeUrl?: string | undefined;
  note?: string | undefined;
};

/** Lock the time in. One idempotency key per tap (ADR 0016). */
export async function confirmMeetup(input: ConfirmInput): Promise<ConfirmMeetupResponse> {
  return invokeFunction(
    'confirm-meetup',
    ConfirmMeetupRequest.parse({
      idempotency_key: newIdempotencyKey(),
      plan_id: input.planId,
      candidate_id: input.candidateId,
      expected_set_id: input.expectedSetId,
      chased_answer: input.chasedAnswer,
      place_name: input.placeName,
      place_url: input.placeUrl,
      note: input.note,
    }),
    ConfirmMeetupResponse,
  );
}

/** Why an attendance write did not land, for a screen to branch on. */
export class AttendanceError extends Error {
  constructor(readonly reason: 'refused' | 'not_found' | 'failed') {
    super(`attendance update ${reason}`);
    this.name = 'AttendanceError';
  }
}

/**
 * "I can't make it after all" and back (spec §5.7).
 *
 * Not an endpoint: a direct write to the member's own `attendance` row through
 * their own session. `attendance_update_own` lets them touch their row and
 * nobody else's, and the trigger holds the rules — the same answer twice
 * changes nothing, and nothing goes back across the meetup.
 *
 * Asks for the row back, because an update RLS filtered out is not an error to
 * PostgREST — it is zero rows, and a screen told "done" about a write that
 * never happened would say "You're going" to somebody the circle sees as out.
 */
export async function setAttendance(
  confirmationId: string,
  userId: string,
  status: 'going' | 'cant',
): Promise<void> {
  const { data, error } = await authClient()
    .from('attendance')
    .update({ status })
    .eq('confirmation_id', confirmationId)
    .eq('user_id', userId)
    .select('status');
  if (error !== null) {
    // 23514 is the trigger's `check_violation`: not reversible, or the
    // confirmation is no longer live.
    throw new AttendanceError(error.code === '23514' ? 'refused' : 'failed');
  }
  if (data.length === 0) throw new AttendanceError('not_found');
}

/**
 * The confirmed meetup as an `.ics`, as text.
 *
 * `generate-ics` is a GET behind the member's bearer, so a browser cannot
 * simply navigate to it: the file is fetched here and handed to the platform
 * to save. The filename is not read from `Content-Disposition` — the function
 * does not expose that header to another origin — and is named by the caller
 * with the domain's own `icsFilename`, the same rule the function uses.
 */
export async function calendarFile(confirmationId: string): Promise<string> {
  const query = new URLSearchParams(
    GenerateIcsRequest.parse({ confirmation_id: confirmationId }),
  ).toString();
  const { data, error } = await authClient().functions.invoke(`generate-ics?${query}`, {
    method: 'GET',
  });
  if (error !== null) {
    const problem = await problemOf(error);
    throw new FunctionError(problem, problem?.message ?? 'generate-ics failed');
  }
  if (typeof data !== 'string') throw new FunctionError(undefined, 'generate-ics failed');
  return data;
}
