/**
 * An absolute moment, as epoch milliseconds.
 *
 * Milliseconds rather than an ISO string because the candidate engine
 * enumerates tens of thousands of half-hour starts across a fortnight
 * (architecture §12): comparison is `<`, arithmetic is addition, and nothing
 * parses a string in a loop. ISO strings are what cross the wire — `toISO` and
 * `fromISO` are the only places the two representations meet.
 */
export type Instant = number & { readonly __brand: 'Instant' };

export function instant(epochMillis: number): Instant {
  if (!Number.isFinite(epochMillis)) {
    throw new RangeError(`Not an instant: ${epochMillis}`);
  }
  return epochMillis as Instant;
}

/** Parse an ISO 8601 string with an offset. Throws on anything else. */
export function fromISO(iso: string): Instant {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) throw new RangeError(`Not an ISO instant: ${iso}`);
  return millis as Instant;
}

export function toISO(value: Instant): string {
  return new Date(value).toISOString();
}

/** Negative if a is earlier, positive if later, zero if the same moment. */
export function compare(a: Instant, b: Instant): number {
  return a - b;
}

export function isBefore(a: Instant, b: Instant): boolean {
  return a < b;
}

export function isAfter(a: Instant, b: Instant): boolean {
  return a > b;
}

export function earliest(a: Instant, b: Instant): Instant {
  return (a < b ? a : b) as Instant;
}

export function latest(a: Instant, b: Instant): Instant {
  return (a > b ? a : b) as Instant;
}

export const MINUTE_MILLIS = 60_000;

export function addMinutes(value: Instant, minutes: number): Instant {
  return (value + minutes * MINUTE_MILLIS) as Instant;
}

export function differenceInMinutes(a: Instant, b: Instant): number {
  return (a - b) / MINUTE_MILLIS;
}
