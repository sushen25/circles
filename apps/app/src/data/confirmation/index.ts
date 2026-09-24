/**
 * The confirmed meetup: reading it, locking it in, correcting who is coming,
 * and the calendar file (spec §5.7, S1-28).
 */
export { confirmationViewOf, planConfirmation } from './read';
export type { AttendanceRead, ConfirmationRead, ConfirmationView, PlanConfirmation } from './read';
export { AttendanceError, calendarFile, confirmMeetup, setAttendance } from './write';
export type { ChasedAnswer, ConfirmInput } from './write';
