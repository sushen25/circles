/**
 * A calendar date with no time and no zone — what a person means by "Thursday
 * the 17th". Pairing one with a zone and minutes-of-day gives an `Instant`; see
 * `zone.ts`.
 */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDate(value: string): LocalDate {
  const parts = PATTERN.exec(value);
  if (!parts) throw new RangeError(`Not a local date: ${value}`);
  const [, y, m, d] = parts;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  // Reject 2026-02-31 and friends: a date that does not exist would otherwise
  // silently roll forward the first time it met a Date.
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real date: ${value}`);
  }
  return value as LocalDate;
}

export function fromParts(year: number, month: number, day: number): LocalDate {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return localDate(`${pad(year, 4)}-${pad(month)}-${pad(day)}`);
}

export function toParts(date: LocalDate): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-') as [string, string, string];
  return { year: Number(y), month: Number(m), day: Number(d) };
}

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export function weekday(date: LocalDate): number {
  const { year, month, day } = toParts(date);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = toParts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return fromParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  const a = toParts(from);
  const b = toParts(to);
  const millis = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(millis / 86_400_000);
}

/**
 * Saturday or Sunday. The product's "weekend" presets rest on this, and it is
 * the one place that assumption is written down — a locale where the weekend
 * falls elsewhere changes this function and nothing else (spec §10).
 */
export function isWeekend(date: LocalDate): boolean {
  const day = weekday(date);
  return day === 6 || day === 7;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
