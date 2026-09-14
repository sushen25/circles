import { instant, localDate, zone, type Instant, type LocalDate, type Zone } from '@circles/domain';

/**
 * The boundary between two honest representations of a moment.
 *
 * The wire carries ISO strings, because that is what JSON and Postgres both
 * read. `packages/domain` carries epoch milliseconds, because arithmetic on a
 * string is arithmetic on a format. Neither is wrong and neither should learn
 * the other's, so the conversion lives here rather than in six handlers.
 */

export function toInstant(iso: string): Instant {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new TypeError('not an instant');
  return instant(ms);
}

export function fromInstant(value: Instant): string {
  return new Date(value).toISOString();
}

export function now(): Instant {
  return instant(Date.now());
}

export function toLocalDate(value: string): LocalDate {
  return localDate(value);
}

export function toZone(value: string): Zone {
  return zone(value);
}
