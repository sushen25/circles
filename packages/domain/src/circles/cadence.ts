/**
 * The circle's loose rhythm (spec §5.9). Deliberately loose: this produces
 * "No rush" and "About time for the next one", never "overdue", a streak or a
 * count of days since. The product is trying to help people meet, not to make
 * them feel behind.
 */

import { type Instant, isBefore } from '../shared/instant.js';
import { addDays, fromParts, toParts } from '../shared/local-date.js';
import { type Zone, fromLocal, toLocal } from '../shared/zone.js';
import type { Cadence, Circle } from './types.js';

/**
 * Whole months for the monthly cadences, days for the short ones. A month is
 * not 30 days to anybody who meets on the first Sunday.
 */
const CADENCE_STEP: Record<Exclude<Cadence, 'none'>, { days?: number; months?: number }> = {
  weekly: { days: 7 },
  fortnightly: { days: 14 },
  monthly: { months: 1 },
  two_monthly: { months: 2 },
};

/**
 * How far ahead the nudge appears: a week for the long cadences, two days for
 * the short ones (spec §5.9). Proportion, not a fixed lead — a week's warning
 * on a weekly rhythm would mean the nudge is showing almost always.
 */
export function nudgeLeadDays(cadence: Cadence): number {
  switch (cadence) {
    case 'monthly':
    case 'two_monthly':
      return 7;
    case 'weekly':
    case 'fortnightly':
      return 2;
    case 'none':
      return 0;
  }
}

/**
 * Add whole months to a date, clamping the day. 31 January plus one month is
 * 28 February, not 3 March: a circle that met on the 31st should be due at the
 * end of the next month, not slide into the one after.
 */
function addMonths(date: ReturnType<typeof toParts>, months: number) {
  const zeroBased = date.month - 1 + months;
  const year = date.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromParts(year, month + 1, Math.min(date.day, lastDay));
}

/**
 * When the circle is next due, or `undefined` for `none` — a circle with no
 * goal is never due, which is the whole point of choosing it.
 *
 * Computed in the circle's own zone rather than by adding milliseconds, so a
 * fortnightly circle stays on the same hour across a DST change instead of
 * drifting by one. Takes the zone explicitly (the ticket's signature is
 * `nextDueAt(lastMetAt, cadence)`) because that arithmetic is not possible
 * without it.
 */
export function nextDueAt(lastMetAt: Instant, cadence: Cadence, z: Zone): Instant | undefined {
  if (cadence === 'none') return undefined;

  const local = toLocal(lastMetAt, z);
  const step = CADENCE_STEP[cadence];
  const date =
    step.months === undefined
      ? addDays(local.date, step.days ?? 0)
      : addMonths(toParts(local.date), step.months);

  return fromLocal(date, local.minutesOfDay, z);
}

/**
 * What the circle home shows in place of "Next one".
 *
 * - `active_plan` — a plan is already running; the plan card wins over any
 *   cadence prompt, because the group has already done the thing being nudged.
 * - `no_goal` — cadence is `none`. Copy: "No goal set".
 * - `never_met` — a goal, but no history to measure from. Copy: "Nothing yet".
 * - `due_soon` — within the lead days of the due date. Copy: "About time for
 *   the next one".
 * - `no_rush` — everything else. Copy: "No rush".
 *
 * `never_met` is a fifth state the ticket's four did not name. It is needed:
 * the artboards show a circle that has never met ("Last caught up · Not yet")
 * and one that is simply not due yet, and those are different sentences. The
 * copy itself lives in `apps/app/src/copy`, not here.
 */
export type CadenceState = 'active_plan' | 'no_goal' | 'never_met' | 'due_soon' | 'no_rush';

export function cadenceState(circle: Circle, now: Instant, hasActivePlan = false): CadenceState {
  if (hasActivePlan) return 'active_plan';
  if (circle.cadence === 'none') return 'no_goal';
  if (circle.lastMetAt === undefined) return 'never_met';

  // Snooze suppresses the prompt without changing the due date, so the rhythm
  // is not silently pushed back by asking for quiet.
  if (circle.cadenceSnoozedUntil !== undefined && isBefore(now, circle.cadenceSnoozedUntil)) {
    return 'no_rush';
  }

  const due = nextDueAt(circle.lastMetAt, circle.cadence, circle.zone);
  if (due === undefined) return 'no_rush';

  const local = toLocal(due, circle.zone);
  const showFrom = fromLocal(
    addDays(local.date, -nudgeLeadDays(circle.cadence)),
    local.minutesOfDay,
    circle.zone,
  );

  return isBefore(now, showFrom) ? 'no_rush' : 'due_soon';
}
