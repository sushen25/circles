import { z } from 'zod';

/**
 * Time at the boundary is always an absolute instant plus a named zone, never a
 * naive local string: the product spans people who are not in the same place,
 * and a stored offset goes wrong the moment daylight saving moves.
 *
 * The domain package owns the arithmetic (S0-07); these are only the shapes
 * that cross the wire.
 */

/** An absolute moment, ISO 8601 with an offset. */
export const Instant = z.iso.datetime({ offset: true }).brand<'Instant'>();
export type Instant = z.infer<typeof Instant>;

/** A calendar date with no time and no zone — `2026-09-19`. */
export const LocalDate = z.iso.date().brand<'LocalDate'>();
export type LocalDate = z.infer<typeof LocalDate>;

/**
 * An IANA zone name. Validated against the runtime's own tz database rather
 * than a regex, so a plausible-looking but non-existent zone is rejected here
 * instead of at the point it is used to render a time.
 */
export const Zone = z.string().refine(isZone, 'not an IANA time zone').brand<'Zone'>();
export type Zone = z.infer<typeof Zone>;

function isZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A half-open interval. Half-open so that adjacent intervals do not overlap at
 * their shared boundary — the availability engine relies on it.
 */
export const Interval = z
  .object({ start: Instant, end: Instant })
  .refine((i) => i.start < i.end, 'interval ends before it starts');
export type Interval = z.infer<typeof Interval>;

/** Minutes. Durations are never expressed in milliseconds at the boundary. */
export const DurationMinutes = z
  .int()
  .positive()
  .max(24 * 60);
export type DurationMinutes = z.infer<typeof DurationMinutes>;
