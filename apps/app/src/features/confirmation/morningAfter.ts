import type { PlanConfirmation, RetrospectiveAnswer } from '../../data/confirmation';
import { dateOf, weekdayOf } from '../scheduling/words';

/**
 * Where the morning after stands for the person reading a plan (spec §5.10).
 *
 * Every answer here is read off what the server said, not worked out on this
 * phone: `view` is `past` only once the meetup has ended **by the database's
 * clock** (`planConfirmation`), which is exactly when `report-outcome` starts
 * taking answers; the plan's state and the confirmation's status say whether
 * the organiser has reported; and the reader's own attendance row says whether
 * they were asked and what they said. Whether a given answer is then allowed is
 * the server's to refuse, and the screens show its refusal.
 */

/**
 * The organiser's question.
 *
 * - `ask` — ended, and not yet reported.
 * - `answered` — reported: the plan is `completed` (by any of the four).
 * - `early` — locked in and still ahead.
 * - `off` — never locked in, reopened by a change of time, or cancelled
 *   before the day: there is no evening to report on.
 */
export type OutcomeStage = 'ask' | 'answered' | 'early' | 'off';

export function outcomeStageOf(data: PlanConfirmation): OutcomeStage {
  const confirmation = data.confirmation;
  if (confirmation === null || data.view === 'open' || data.view === 'over') return 'off';
  if (data.view === 'confirmed') return 'early';
  return data.state === 'confirmed' && confirmation.status === 'active' ? 'ask' : 'answered';
}

/**
 * A member's question.
 *
 * - `ask` — ended, and theirs to answer; `said` is an earlier answer, which
 *   they may change either way (`was_there` ↔ `missed`).
 * - `not_asked` — no attendance row: they joined after the time was locked in,
 *   and `report-outcome` would refuse them `attendance_not_a_participant`.
 * - `early`, `off` — as for the organiser. Also `off` when the organiser said
 *   it was cancelled: that confirmation takes no more attendance.
 */
export type AttendanceStage =
  { kind: 'ask'; said: RetrospectiveAnswer | undefined } | { kind: 'not_asked' | 'early' | 'off' };

export function attendanceStageOf(data: PlanConfirmation): AttendanceStage {
  const confirmation = data.confirmation;
  if (confirmation === null || data.view === 'open' || data.view === 'over') {
    return { kind: 'off' };
  }
  if (confirmation.status === 'cancelled') return { kind: 'off' };
  const mine = data.attendance.find((a) => a.userId === data.me);
  if (mine === undefined) return { kind: 'not_asked' };
  if (data.view === 'confirmed') return { kind: 'early' };
  return {
    kind: 'ask',
    said: mine.status === 'was_there' || mine.status === 'missed' ? mine.status : undefined,
  };
}

/** "Sunday Crew · Thu 17 Sep" and "Thursday", for either screen's heading. */
export type MorningAfterWords = { circle: string; date: string; day: string };

export function morningAfterWords(data: PlanConfirmation): MorningAfterWords | undefined {
  const confirmation = data.confirmation;
  if (confirmation === null) return undefined;
  return {
    circle: data.circleName,
    date: dateOf(confirmation.startsAt, data.zone),
    day: weekdayOf(confirmation.startsAt, data.zone),
  };
}
