/**
 * The circle's loose rhythm (spec §5.9). Deliberately loose: this produces
 * "No rush" and "About time for the next one", never "overdue", a streak or a
 * count of days since. The product is trying to help people meet, not to make
 * them feel behind.
 */

import { type Instant, isBefore } from '../shared/instant.js';
import { type LocalDate, addDays, daysBetween, fromParts, toParts } from '../shared/local-date.js';
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

/**
 * The due date a cadence nudge is owed for, now — or `undefined` when none is.
 *
 * Owed exactly while circle home says **About time for the next one**
 * (`cadenceState` is `due_soon`): the circle is active, has a goal and a
 * history, is not snoozed, and nothing is running (spec §5.9). The dispatcher
 * sends one nudge per cycle, the moment this first answers one, and it
 * asks again at send time so that a plan made, a snooze or a meetup that
 * happened in between stops a letter already queued.
 *
 * The answer is the circle-local calendar date the circle falls due on. It is
 * what makes September's nudge different from October's (`occurrenceFor`),
 * and it does not move when somebody snoozes: snoozing suppresses the prompt,
 * never the rhythm.
 */
export function nudgeDueDate(
  circle: Circle,
  now: Instant,
  hasOpenPlan: boolean,
): LocalDate | undefined {
  if (circle.status === 'archived' || circle.lastMetAt === undefined) return undefined;
  if (cadenceState(circle, now, hasOpenPlan) !== 'due_soon') return undefined;
  const due = nextDueAt(circle.lastMetAt, circle.cadence, circle.zone);
  return due === undefined ? undefined : toLocal(due, circle.zone).date;
}

/**
 * Until when **Snooze a month** quiets the prompt: one calendar month from
 * now, at the same local time, in the circle's zone. 31 January snoozes to
 * 28 February, as `nextDueAt` would have it.
 *
 * A month whatever the cadence, because that is what the button says. It
 * moves `cadenceSnoozedUntil` and nothing else — the due date stays where
 * `lastMetAt` put it (ADR 0036).
 */
export function snoozeAMonth(now: Instant, z: Zone): Instant {
  const local = toLocal(now, z);
  return fromLocal(addMonths(toParts(local.date), 1), local.minutesOfDay, z);
}

/**
 * Whole weeks between the last meetup and now, in the circle's zone — the
 * about-time email's "about a month". Never negative, and never shown as a
 * count (spec §5.9): the email turns it into loose words.
 */
export function weeksSince(lastMetAt: Instant, now: Instant, z: Zone): number {
  const days = daysBetween(toLocal(lastMetAt, z).date, toLocal(now, z).date);
  return Math.max(0, Math.floor(days / 7));
}

/**
 * Which of circle home's states a circle is in (spec §5.2), and the line the
 * circles list writes under its name.
 *
 * - `finding_a_time` — a named plan is collecting answers. It wins over a
 *   meetup already locked in, because it is the one waiting on somebody.
 * - `locked_in` — a confirmed meetup still ahead.
 * - `just_you` — nobody has joined yet: the only useful thing is the link.
 * - otherwise the cadence, in `cadenceState`'s terms: `about_time` for
 *   `due_soon`, and `never_met`, `no_goal` and `no_rush` as they are.
 *
 * Never "overdue", never a count (spec §5.9): `about_time` stays `about_time`
 * however long it has been.
 */
export type CircleHomeState =
  'finding_a_time' | 'locked_in' | 'just_you' | 'about_time' | 'never_met' | 'no_goal' | 'no_rush';

export type CircleHomeInput = {
  readonly circle: Circle;
  readonly now: Instant;
  /** A named plan collecting answers. */
  readonly findingATime: boolean;
  /** An active confirmation whose meetup has not ended. */
  readonly lockedIn: boolean;
  readonly activeMembers: number;
};

export function circleHomeState(input: CircleHomeInput): CircleHomeState {
  if (input.findingATime) return 'finding_a_time';
  if (input.lockedIn) return 'locked_in';
  if (input.activeMembers <= 1) return 'just_you';
  switch (cadenceState(input.circle, input.now)) {
    case 'due_soon':
      return 'about_time';
    case 'never_met':
      return 'never_met';
    case 'no_goal':
      return 'no_goal';
    case 'no_rush':
    case 'active_plan':
      return 'no_rush';
  }
}
