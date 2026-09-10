/**
 * Who is coming, and — afterwards — who came (spec §5.7, §5.10).
 *
 * The initial statuses are **derived, never asked for**: a member who marked
 * times that fit is going, and telling them so is the point of "Every member
 * sees Going / Can't make it / To confirm from their response and may correct
 * it". Asking six people to re-confirm a thing they already answered is exactly
 * the friction the product exists to remove.
 *
 * Nothing here reads a clock. Whether the meetup has happened is the caller's
 * knowledge, and the transition table below is arranged so that a status about
 * the past never turns back into a promise about the future — which is the only
 * ordering rule a clock would have given us.
 */

import type { UserId } from '../circles/types.js';
import type { Response } from '../availability/types.js';
import { type Result, err, ok } from '../shared/result.js';
import type { Instant } from '../shared/instant.js';
import type {
  Attendance,
  AttendanceChoice,
  AttendanceStatus,
  Confirmation,
  ConfirmationId,
} from './types.js';

/**
 * The initial status of every active member.
 *
 * `going` for anyone frozen into the confirmation as available — including
 * flexible members, who said yes to whatever suits. `cant` for anyone who
 * answered and is not in that set: they either marked other times or said none
 * of these work, and both are an answer. `unknown` for anyone who never
 * answered, which the ConfirmedOrg artboard renders as "1 to confirm" rather
 * than as a no.
 *
 * Responses from another revision are ignored: an edit invalidated them, and
 * reusing them would be answering a question nobody was asked.
 */
export function deriveAttendance(
  confirmation: Confirmation,
  responses: readonly Response[],
  members: readonly UserId[],
): readonly Attendance[] {
  const available = new Set(confirmation.candidate.availableUserIds);
  const answered = new Set(
    responses
      .filter((r) => r.planId === confirmation.planId && r.revision === confirmation.revision)
      .map((r) => r.userId),
  );

  return members.map((userId) => ({
    confirmationId: confirmation.id,
    userId,
    status: statusFor(userId, available, answered),
    // Derived at the moment of confirmation, so it is not a fresh fact with a
    // timestamp of its own — it is what the confirmation already said.
    updatedAt: confirmation.confirmedAt,
  }));
}

function statusFor(
  userId: UserId,
  available: ReadonlySet<UserId>,
  answered: ReadonlySet<UserId>,
): AttendanceStatus {
  if (available.has(userId)) return 'going';
  return answered.has(userId) ? 'cant' : 'unknown';
}

/**
 * What a member may change their status to.
 *
 * Before the meetup, `going` and `cant` swap freely — "Tap below if that
 * changes" is on the confirmed screen, and a person whose evening frees up
 * should not be stuck. Afterwards, `was_there` and `missed` swap freely too,
 * because the WasThere screen can be tapped wrongly.
 *
 * What is not allowed is going backwards across the meetup: once someone has
 * said whether they were there, "I'm going" is not a correction, it is a
 * different question. Attempting it is a caller bug, and refusing is how the
 * caller finds out.
 */
const ALLOWED: Record<AttendanceStatus, readonly AttendanceChoice[]> = {
  unknown: ['going', 'cant', 'was_there', 'missed'],
  going: ['cant', 'was_there', 'missed'],
  cant: ['going', 'was_there', 'missed'],
  was_there: ['missed'],
  missed: ['was_there'],
};

export type AttendanceError = {
  readonly code: 'attendance_not_reversible';
  readonly from: AttendanceStatus;
  readonly to: AttendanceChoice;
};

export function canUpdateAttendance(current: AttendanceStatus, choice: AttendanceChoice): boolean {
  return current === choice || ALLOWED[current].includes(choice);
}

/**
 * The member's new status, or a refusal.
 *
 * Choosing what you already are succeeds and changes nothing: two taps on the
 * same button is not an error, and returning the same status keeps the caller
 * from having to special-case it.
 */
export function updateAttendance(
  current: AttendanceStatus,
  choice: AttendanceChoice,
): Result<AttendanceError, AttendanceStatus> {
  if (!canUpdateAttendance(current, choice)) {
    return err({ code: 'attendance_not_reversible', from: current, to: choice });
  }
  return ok(choice);
}

/** The same move, applied to a stored row. */
export function applyAttendance(
  attendance: Attendance,
  choice: AttendanceChoice,
  now: Instant,
): Result<AttendanceError, Attendance> {
  const next = updateAttendance(attendance.status, choice);
  return next.ok ? ok({ ...attendance, status: next.value, updatedAt: now }) : next;
}

export type AttendanceCounts = Readonly<Record<AttendanceStatus, number>>;

/** "5 going · 1 to confirm" — the counts the confirmed screens render. */
export function attendanceCounts(attendances: readonly Attendance[]): AttendanceCounts {
  const counts: Record<AttendanceStatus, number> = {
    going: 0,
    cant: 0,
    unknown: 0,
    was_there: 0,
    missed: 0,
  };
  for (const attendance of attendances) counts[attendance.status] += 1;
  return counts;
}

/** Everyone still to say, in members order — "Alex hasn't said yet". */
export function awaitingReply(attendances: readonly Attendance[]): readonly UserId[] {
  return attendances.filter((a) => a.status === 'unknown').map((a) => a.userId);
}

/** Whether a given member is in this confirmation's attendance at all. */
export function attendanceOf(
  attendances: readonly Attendance[],
  userId: UserId,
  confirmationId: ConfirmationId,
): Attendance | undefined {
  return attendances.find((a) => a.userId === userId && a.confirmationId === confirmationId);
}
