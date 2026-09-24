/**
 * The confirmed meetup: reading it, locking it in, correcting who is coming,
 * the calendar file (spec §5.7, S1-28), and the morning after (§5.10, S1-29).
 */
export { confirmationViewOf, planConfirmation } from './read';
export type { AttendanceRead, ConfirmationRead, ConfirmationView, PlanConfirmation } from './read';
export { AttendanceError, calendarFile, confirmMeetup, setAttendance } from './write';
export type { ChasedAnswer, ConfirmInput } from './write';
export { reportAttendance, reportOutcome } from './outcome';
export type { OutcomeEvidence, RetrospectiveAnswer } from './outcome';
export { attendanceDismissed, morningAfterOf, setAttendanceDismissed } from './morning';
export type { MorningAfter } from './morning';
