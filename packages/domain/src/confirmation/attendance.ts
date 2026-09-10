/**
 * Who is coming, and — afterwards — who came (spec §5.7, §5.10).
 *
 * The initial statuses are **derived, never asked for**: a member who marked
 * times that fit is going, and telling them so is the point of "Every member
 * sees Going / Can't make it / To confirm from their response and may correct
 * it". Asking six people to re-confirm a thing they already answered is exactly
 * the friction the product exists to remove.
 *
 * The two questions are separated by the meetup itself, so the transitions need
 * to know when that is: "I was there" before the evening has happened is not an
 * early answer, it is a false one, and `corroboration` would go on to count it.
 * An earlier revision left that to the client, which is a transition guard
 * living outside the domain — precisely what §6.4 forbids.
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

/** Claims about the past. Nobody may make one before the past exists. */
const RETROSPECTIVE: readonly AttendanceChoice[] = ['was_there', 'missed'];

/**
 * When the meetup ends, and when the member is answering.
 *
 * Both, rather than a boolean the caller computes: "has it finished?" answered
 * somewhere else is the guard living somewhere else.
 */
export type AttendanceMoment = {
  /** The confirmed meetup's end — `confirmation.candidate.end`. */
  readonly meetupEnd: Instant;
  readonly now: Instant;
};

export type AttendanceError = {
  readonly code: 'attendance_not_reversible' | 'attendance_too_early';
  readonly from: AttendanceStatus;
  readonly to: AttendanceChoice;
};

function problem(
  current: AttendanceStatus,
  choice: AttendanceChoice,
  moment: AttendanceMoment,
): AttendanceError['code'] | undefined {
  if (RETROSPECTIVE.includes(choice) && moment.now < moment.meetupEnd) {
    return 'attendance_too_early';
  }
  if (current !== choice && !ALLOWED[current].includes(choice)) return 'attendance_not_reversible';
  return undefined;
}

export function canUpdateAttendance(
  current: AttendanceStatus,
  choice: AttendanceChoice,
  moment: AttendanceMoment,
): boolean {
  return problem(current, choice, moment) === undefined;
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
  moment: AttendanceMoment,
): Result<AttendanceError, AttendanceStatus> {
  const code = problem(current, choice, moment);
  return code === undefined ? ok(choice) : err({ code, from: current, to: choice });
}

/**
 * The same move, applied to a stored row — and idempotent, as every transition
 * has to be (architecture §7.6).
 *
 * A repeat of the choice already recorded returns the row untouched rather than
 * restamping it. Two taps on the same button, or a retried request, would
 * otherwise look like a fresh answer: the confirmed screen orders by
 * `updatedAt`, and "Priya just changed her mind" is a thing it would then say
 * about somebody who did not.
 */
export function applyAttendance(
  attendance: Attendance,
  choice: AttendanceChoice,
  confirmation: Confirmation,
  now: Instant,
): Result<AttendanceError, Attendance> {
  const moment = { meetupEnd: confirmation.candidate.end, now };
  const next = updateAttendance(attendance.status, choice, moment);
  if (!next.ok) return next;
  if (attendance.status === choice) return ok(attendance);
  return ok({ ...attendance, status: next.value, updatedAt: now });
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
