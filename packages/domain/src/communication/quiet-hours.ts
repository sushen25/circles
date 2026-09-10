/**
 * Quiet hours: 21:00–08:00 in the **recipient's** zone (spec §5.8, §13).
 *
 * Recipient's, not the circle's — a member who has moved to London is asleep at
 * different absolute instants from the rest of the Sunday Crew, and a rule
 * computed in the plan's zone would buzz them at four in the morning to be
 * polite to somebody else.
 *
 * A held message is moved to 08:00 local, never dropped, and never moved
 * earlier: `scheduleFor` only ever returns an instant at or after the one it
 * was given.
 */

import { addDays } from '../shared/local-date.js';
import type { Instant } from '../shared/instant.js';
import { type Zone, fromLocal, toLocal } from '../shared/zone.js';
import { type NotificationKind, notificationSpec } from './kinds.js';

/** 21:00 and 08:00 as minutes since local midnight. */
export const QUIET_START_MIN = 21 * 60;
export const QUIET_END_MIN = 8 * 60;

/** The window wraps midnight, so this is an "or", not a range check. */
export function isQuietMinute(minutesOfDay: number): boolean {
  return minutesOfDay >= QUIET_START_MIN || minutesOfDay < QUIET_END_MIN;
}

export function isQuietHourFor(value: Instant, zone: Zone): boolean {
  return isQuietMinute(toLocal(value, zone).minutesOfDay);
}

/**
 * When this message should actually be sent.
 *
 * Unchanged when the kind is exempt, or when the desired time is already inside
 * waking hours. Otherwise the next 08:00 local: the same morning for something
 * that landed after midnight, the next morning for something that landed in the
 * evening.
 *
 * Computed through `fromLocal`, so the day the clocks change still resolves to
 * the 08:00 people read on a clock rather than to an offset arithmetic guess.
 */
export function scheduleFor(kind: NotificationKind, desiredAt: Instant, zone: Zone): Instant {
  if (!notificationSpec(kind).respectsQuietHours) return desiredAt;

  const local = toLocal(desiredAt, zone);
  if (!isQuietMinute(local.minutesOfDay)) return desiredAt;

  const morning = local.minutesOfDay >= QUIET_START_MIN ? addDays(local.date, 1) : local.date;
  return fromLocal(morning, QUIET_END_MIN, zone);
}

/** Whether this send was moved — for a log line, and for a test to assert on. */
export function wasHeld(kind: NotificationKind, desiredAt: Instant, zone: Zone): boolean {
  return scheduleFor(kind, desiredAt, zone) !== desiredAt;
}
