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

/**
 * Minutes, and only the six a meetup may last (spec §5.3; ADR 0031 added two).
 *
 * `DURATIONS` in `packages/domain` is the same list; a plan whose duration is
 * not one of them has no card to render and no default to fall back to, so the
 * boundary refuses it rather than the screen discovering it later.
 */
export const DurationMinutes = z.union([
  z.literal(60),
  z.literal(90),
  z.literal(120),
  z.literal(180),
  z.literal(240),
  z.literal(300),
]);
export type DurationMinutes = z.infer<typeof DurationMinutes>;

/**
 * The calendar days a plan may land on, inclusive — `{ start: '2026-09-17', end:
 * '2026-09-20' }` is four days, not three. At most thirty (spec §5.3, ADR 0030), which
 * the domain enforces when it resolves the window; the shape is checked here.
 */
export const DateWindow = z
  .object({ start: LocalDate, end: LocalDate })
  .refine((w) => w.start <= w.end, 'window ends before it starts');
export type DateWindow = z.infer<typeof DateWindow>;

/**
 * The hours of each day being asked about, as minutes since local midnight —
 * 17:30 is 1050. Not an `Interval`, which is absolute: this repeats on every day
 * of the window, and 8 pm means 8 pm wherever the circle is.
 *
 * Half hours, because that is the granularity the availability painter, the
 * engine's start times and the willing windows all already work in. An edge at
 * 17:45 would put the first cell at 18:00 and lose the quarter hour.
 */
export const DailyWindow = z
  .object({
    startMin: z
      .int()
      .min(0)
      .max(24 * 60),
    endMin: z
      .int()
      .min(0)
      .max(24 * 60),
  })
  .refine((d) => d.startMin < d.endMin, 'band ends before it starts')
  .refine((d) => d.startMin % 30 === 0 && d.endMin % 30 === 0, 'band is not on a half hour');
export type DailyWindow = z.infer<typeof DailyWindow>;
