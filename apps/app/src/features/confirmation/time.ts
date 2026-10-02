import {
  OWN_TIME_MAX_MINUTES,
  OWN_TIME_MIN_MINUTES,
  addDays,
  askedDays,
  fromISO,
  fromLocal,
  lastOwnTimeDay,
  localDate,
  ownTimeProblem,
  toISO,
  toLocal,
  zone as toZone,
  type Instant,
  type LocalDate,
  type OwnTimeProblem,
} from '@circles/domain';

import type { PlanCandidates } from '../../data/scheduling';

/**
 * The picker's clock (ADR 0050): one day, a start and an end on the half hour.
 *
 * Minutes since local midnight on the picked day, so stepping is arithmetic and
 * a stretch that runs past midnight is an end beyond 24:00 rather than a second
 * day to keep track of. The rules are the domain's (`ownTimeProblem`, the
 * length bounds, the last day); this only moves the numbers and turns them into
 * instants on the plan's clock.
 */

export type TimePick = {
  /** The local day the stretch starts on, in the plan's zone. */
  day: LocalDate;
  startMin: number;
  /** After `startMin`, and past 1440 when the stretch crosses midnight. */
  endMin: number;
};

const STEP = 30;
const DAY = 24 * 60;

/** An instant for a clock time on a day, where 24:00 and beyond are the next day's. */
function at(day: LocalDate, minutes: number, zone: string): Instant {
  return minutes >= DAY
    ? fromLocal(addDays(day, 1), minutes - DAY, toZone(zone))
    : fromLocal(day, minutes, toZone(zone));
}

export function instantsOf(pick: TimePick, zone: string): { start: Instant; end: Instant } {
  return { start: at(pick.day, pick.startMin, zone), end: at(pick.day, pick.endMin, zone) };
}

/** The ISO pair the functions take. */
export function isoOf(pick: TimePick, zone: string): { startsAt: string; endsAt: string } {
  const { start, end } = instantsOf(pick, zone);
  return { startsAt: toISO(start), endsAt: toISO(end) };
}

/** A stretch read back off two instants, on the plan's clock. */
export function pickOf(startsAt: string, endsAt: string, zone: string): TimePick {
  const z = toZone(zone);
  const start = toLocal(fromISO(startsAt), z);
  const end = toLocal(fromISO(endsAt), z);
  const length = Math.round((fromISO(endsAt) - fromISO(startsAt)) / 60_000);
  return {
    day: start.date,
    startMin: start.minutesOfDay,
    // From the real length, not the end's clock: a stretch over a change of
    // clocks has the length it has, and the end's own date is no help to it.
    endMin: end.date === start.date ? end.minutesOfDay : start.minutesOfDay + length,
  };
}

/** The same stretch, on another day: what picking a day does. */
export function onDay(pick: TimePick, day: LocalDate): TimePick {
  return { ...pick, day };
}

export const lengthOf = (pick: TimePick): number => pick.endMin - pick.startMin;

/** Moving the start keeps the length (the design's "Earlier" and "Later" on Starts). */
export function moveStart(pick: TimePick, by: 1 | -1): TimePick {
  const startMin = pick.startMin + by * STEP;
  if (startMin < 0 || startMin > DAY - STEP) return pick;
  return { ...pick, startMin, endMin: pick.endMin + by * STEP };
}

/** Moving the end changes the length, within what the product allows. */
export function moveEnd(pick: TimePick, by: 1 | -1): TimePick {
  const endMin = pick.endMin + by * STEP;
  const length = endMin - pick.startMin;
  if (length < OWN_TIME_MIN_MINUTES || length > OWN_TIME_MAX_MINUTES) return pick;
  return { ...pick, endMin };
}

export const canMoveStart = (pick: TimePick, by: 1 | -1): boolean => moveStart(pick, by) !== pick;
export const canMoveEnd = (pick: TimePick, by: 1 | -1): boolean => moveEnd(pick, by) !== pick;

/** What the domain says about the stretch now, on the plan's clock. */
export function problemOf(
  plan: Pick<PlanCandidates, 'zone' | 'windowStart' | 'windowEnd' | 'days'>,
  pick: TimePick,
  now: Instant,
): OwnTimeProblem | undefined {
  const { start, end } = instantsOf(pick, plan.zone);
  return ownTimeProblem(planShape(plan), start, end, now);
}

/** The plan as the domain's own-time rule wants it: its zone and its dates. */
export function planShape(
  plan: Pick<PlanCandidates, 'zone' | 'windowStart' | 'windowEnd' | 'days'>,
) {
  return {
    zone: toZone(plan.zone),
    window: {
      start: localDate(plan.windowStart),
      end: localDate(plan.windowEnd),
      ...(plan.days === undefined ? {} : { days: plan.days.map(localDate) }),
    },
  };
}

/** The last day that may be picked: the plan's last day, and thirty more. */
export function lastDay(plan: Pick<PlanCandidates, 'zone' | 'windowStart' | 'windowEnd' | 'days'>) {
  return lastOwnTimeDay(planShape(plan));
}

/**
 * Where the picker opens: the option that was selected, or the closest
 * near-miss, or — on the waiting screen, with nothing to start from — the first
 * day the plan asks about that is still ahead, at the start of its band and for
 * the length it asked.
 */
export function initialPick(
  plan: PlanCandidates,
  now: Instant,
  chosen?: { startsAt: string; endsAt: string } | undefined,
): TimePick {
  const known = chosen ?? plan.candidates[0] ?? plan.nearMisses[0];
  if (known !== undefined) return pickOf(known.startsAt, known.endsAt, plan.zone);

  const today = toLocal(now, toZone(plan.zone)).date;
  const shape = planShape(plan);
  const length = plan.durationMinutes;
  const days = askedDays(shape.window).filter((day) => day >= today);
  for (const day of days) {
    const pick = { day, startMin: plan.dailyStartMin, endMin: plan.dailyStartMin + length };
    if (instantsOf(pick, plan.zone).start > now) return pick;
  }
  // Every asked day is gone: tomorrow, the way a plan that never asked would.
  return {
    day: addDays(today, 1),
    startMin: plan.dailyStartMin,
    endMin: plan.dailyStartMin + length,
  };
}
