import { HALF_HOUR, isViableBand, validateBand } from '@circles/domain';

import type { Band } from './form';

/**
 * The time-of-day control (spec §5.3: "preset defaults … ; custom").
 *
 * The two named bands are the presets' own suggestions, offered by name; the
 * third is any band at all, moved half an hour at a time. **It snaps rather
 * than refuses**: `band_unaligned` exists because a 17:45 edge would quietly
 * lose a quarter hour on every painter and engine downstream, so the control
 * cannot produce one (S1-02's third note).
 */
export const EVENINGS: Band = { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 };
export const DAYTIME: Band = { startMin: 9 * 60, endMin: 22 * 60 + 30 };
/** Where "Custom" starts from when nothing custom has been chosen yet. */
export const CUSTOM_START: Band = { startMin: 12 * 60, endMin: 17 * 60 };

export type BandKind = 'evenings' | 'daytime' | 'custom';

export function sameBand(a: Band, b: Band): boolean {
  return a.startMin === b.startMin && a.endMin === b.endMin;
}

export function bandKind(band: Band): BandKind {
  if (sameBand(band, EVENINGS)) return 'evenings';
  if (sameBand(band, DAYTIME)) return 'daytime';
  return 'custom';
}

/**
 * Move one edge by half an hour, inside the day and never past the other
 * edge. A move that would break either is simply not made — the button that
 * asked for it is disabled by `canStep`.
 */
export function stepBand(band: Band, edge: 'start' | 'end', direction: 1 | -1): Band {
  const next =
    edge === 'start'
      ? { startMin: band.startMin + direction * HALF_HOUR, endMin: band.endMin }
      : { startMin: band.startMin, endMin: band.endMin + direction * HALF_HOUR };
  return validateBand(next) === undefined ? next : band;
}

export function canStep(band: Band, edge: 'start' | 'end', direction: 1 | -1): boolean {
  return !sameBand(stepBand(band, edge, direction), band);
}

/**
 * How many half hours a day this band asks each person to consider. The
 * evening band is ten; a whole day is nearly thirty, and every one of them is
 * a cell somebody scrolls past (ADR 0009) — so the screen says what the
 * choice costs rather than only offering it.
 */
export function cellsPerDay(band: Band): number {
  return Math.max(0, (band.endMin - band.startMin) / HALF_HOUR);
}

/** Whether the meetup fits in the band at all (`band_shorter_than_meetup`). */
export function fits(band: Band, duration: number): boolean {
  return isViableBand(band, duration);
}
