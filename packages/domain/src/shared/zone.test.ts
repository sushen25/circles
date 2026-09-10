import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Instant, MINUTE_MILLIS, fromISO, instant, toISO } from './instant';
import { localDate } from './local-date';
import {
  ceilToLocalSlot,
  floorToLocalSlot,
  fromLocal,
  isAlignedToLocalSlot,
  offsetMinutes,
  toLocal,
  zone,
} from './zone';

const MELBOURNE = zone('Australia/Melbourne');
const ADELAIDE = zone('Australia/Adelaide');
const LONDON = zone('Europe/London');

const at = (date: string, minutes: number, z = MELBOURNE) => fromLocal(localDate(date), minutes, z);
const hm = (h: number, m = 0) => h * 60 + m;

describe('zone', () => {
  it('rejects a plausible but non-existent zone', () => {
    expect(() => zone('Australia/Melbourn')).toThrow(/Not an IANA time zone/);
    expect(() => zone('AEST')).toThrow();
  });
});

describe('an ordinary day', () => {
  it('reads the wall clock the way a person would', () => {
    const evening = at('2026-09-17', hm(18, 30));
    expect(toISO(evening)).toBe('2026-09-17T08:30:00.000Z');
    expect(toLocal(evening, MELBOURNE)).toEqual({
      date: localDate('2026-09-17'),
      minutesOfDay: hm(18, 30),
    });
  });

  it('handles a half-hour zone', () => {
    // Adelaide is +9:30 in winter, +10:30 in daylight saving.
    expect(offsetMinutes(at('2026-06-01', hm(18, 30), ADELAIDE), ADELAIDE)).toBe(570);
    expect(offsetMinutes(at('2026-12-01', hm(18, 30), ADELAIDE), ADELAIDE)).toBe(630);
  });

  it('handles a zone that is not Australian', () => {
    expect(offsetMinutes(at('2026-01-15', hm(12), LONDON), LONDON)).toBe(0);
    expect(offsetMinutes(at('2026-07-15', hm(12), LONDON), LONDON)).toBe(60);
  });
});

// Melbourne moves its clocks on the first Sunday of April and October.
describe('when the clocks go back — Melbourne, 5 April 2026, 03:00 becomes 02:00', () => {
  it('is still +11 just before the change', () => {
    expect(offsetMinutes(at('2026-04-05', hm(1, 30)), MELBOURNE)).toBe(660);
  });

  it('takes the first of the two 02:30s', () => {
    const chosen = at('2026-04-05', hm(2, 30));

    // Both of these read 02:30 locally; we want the earlier.
    expect(toISO(chosen)).toBe('2026-04-04T15:30:00.000Z');
    expect(offsetMinutes(chosen, MELBOURNE)).toBe(660);

    const secondOccurrence = instant(chosen + 60 * MINUTE_MILLIS);
    expect(toLocal(secondOccurrence, MELBOURNE).minutesOfDay).toBe(hm(2, 30));
    expect(chosen).toBeLessThan(secondOccurrence);
  });

  it('is +10 after the change', () => {
    expect(offsetMinutes(at('2026-04-05', hm(3, 30)), MELBOURNE)).toBe(600);
  });
});

describe('when the clocks go forward — Melbourne, 4 October 2026, 02:00 becomes 03:00', () => {
  it('is +10 just before the change', () => {
    expect(offsetMinutes(at('2026-10-04', hm(1, 30)), MELBOURNE)).toBe(600);
  });

  it('skips forward for a wall time that never happens', () => {
    // 02:30 does not exist that morning. A plan asked for it must still start.
    const chosen = at('2026-10-04', hm(2, 30));

    expect(toISO(chosen)).toBe('2026-10-03T16:00:00.000Z');
    expect(toLocal(chosen, MELBOURNE)).toEqual({
      date: localDate('2026-10-04'),
      minutesOfDay: hm(3),
    });
  });

  it('skips forward in a half-hour zone too', () => {
    const chosen = at('2026-10-04', hm(2, 30), ADELAIDE);
    expect(toLocal(chosen, ADELAIDE).minutesOfDay).toBe(hm(3));
    expect(offsetMinutes(chosen, ADELAIDE)).toBe(630);
  });

  it('is +11 after the change', () => {
    expect(offsetMinutes(at('2026-10-04', hm(3, 30)), MELBOURNE)).toBe(660);
  });
});

describe('round-tripping', () => {
  /** True when the offset is unchanged for three hours either side. */
  const settled = (value: Instant, z: typeof MELBOURNE) => {
    const here = offsetMinutes(value, z);
    const before = offsetMinutes(instant(value - 180 * MINUTE_MILLIS), z);
    const after = offsetMinutes(instant(value + 180 * MINUTE_MILLIS), z);
    return here === before && here === after;
  };

  it('fromLocal(toLocal(x)) is x, away from a transition', () => {
    fc.assert(
      fc.property(
        // Two years of half-hour instants, across three zones.
        fc.integer({ min: 0, max: 2 * 365 * 48 }),
        fc.constantFrom(MELBOURNE, ADELAIDE, LONDON),
        (slots, z) => {
          const start = Date.UTC(2026, 0, 1) as Instant;
          const value = instant(start + slots * 30 * MINUTE_MILLIS);
          fc.pre(settled(value, z));

          const local = toLocal(value, z);
          expect(fromLocal(local.date, local.minutesOfDay, z)).toBe(value);
        },
      ),
      { numRuns: 600 },
    );
  });

  it('always lands on a real moment, even at a transition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 * 365 * 48 }),
        fc.constantFrom(MELBOURNE, ADELAIDE, LONDON),
        (slots, z) => {
          const start = Date.UTC(2026, 0, 1) as Instant;
          const value = instant(start + slots * 30 * MINUTE_MILLIS);

          const local = toLocal(value, z);
          const back = fromLocal(local.date, local.minutesOfDay, z);

          // Not necessarily the same instant — an overlapped wall time resolves
          // to the first occurrence — but always a moment that exists, and
          // never more than an hour away.
          expect(Number.isFinite(back)).toBe(true);
          expect(Math.abs(back - value)).toBeLessThanOrEqual(60 * MINUTE_MILLIS);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('fromLocal', () => {
  it('refuses minutes outside a day', () => {
    expect(() => fromLocal(localDate('2026-09-17'), -1, MELBOURNE)).toThrow(/out of range/);
    expect(() => fromLocal(localDate('2026-09-17'), 1440, MELBOURNE)).toThrow(/out of range/);
  });
});

describe('local half-hour boundaries', () => {
  // Most zones are offset by a whole or half hour, so local and epoch
  // boundaries coincide. Kathmandu is +05:45, and there they do not.
  const KATHMANDU = zone('Asia/Kathmandu');
  const MELB = zone('Australia/Melbourne');
  const DAY = localDate('2026-09-17');

  it('is aligned when the local clock says so, whatever UTC says', () => {
    const nineAm = fromLocal(DAY, 9 * 60, KATHMANDU);
    expect(isAlignedToLocalSlot(nineAm, KATHMANDU)).toBe(true);
    // …and the same instant is not on an epoch boundary.
    expect(nineAm % (30 * 60_000)).not.toBe(0);
  });

  it('rounds down and up to the local half hour', () => {
    const ragged = fromLocal(DAY, 9 * 60 + 7, KATHMANDU);
    expect(toLocal(floorToLocalSlot(ragged, KATHMANDU), KATHMANDU).minutesOfDay).toBe(9 * 60);
    expect(toLocal(ceilToLocalSlot(ragged, KATHMANDU), KATHMANDU).minutesOfDay).toBe(9 * 60 + 30);
  });

  it('leaves a boundary alone rather than moving it a slot', () => {
    const onTheHalf = fromLocal(DAY, 9 * 60 + 30, KATHMANDU);
    expect(floorToLocalSlot(onTheHalf, KATHMANDU)).toBe(onTheHalf);
    expect(ceilToLocalSlot(onTheHalf, KATHMANDU)).toBe(onTheHalf);
  });

  it('rolls to the next day when rounding up from the last half hour', () => {
    const lateNight = fromLocal(DAY, 23 * 60 + 40, KATHMANDU);
    const rounded = ceilToLocalSlot(lateNight, KATHMANDU);
    const local = toLocal(rounded, KATHMANDU);
    expect(local.date).toBe('2026-09-18');
    expect(local.minutesOfDay).toBe(0);
  });

  it('does not call a moment aligned when it carries seconds', () => {
    // toLocal reports minutes and drops the rest, so checking only its output
    // called 18:30:45 aligned. Callers use this to enforce the invariant that
    // willing windows sit on half hours, so a malformed endpoint would pass.
    const onBoundary = fromLocal(DAY, 18 * 60 + 30, MELB);
    expect(isAlignedToLocalSlot(onBoundary, MELB)).toBe(true);
    expect(isAlignedToLocalSlot(instant(onBoundary + 45_000), MELB)).toBe(false);
    expect(isAlignedToLocalSlot(instant(onBoundary + 1), MELB)).toBe(false);
    expect(isAlignedToLocalSlot(instant(onBoundary + MINUTE_MILLIS), MELB)).toBe(false);
  });

  it('is not thrown off by seconds in the instant', () => {
    // `toLocal` reports whole minutes, so an instant carrying half a second
    // used to read as +599 rather than +600, and every rounding built on it
    // landed a minute out. Latent until something passed an arbitrary instant.
    const withSeconds = fromISO('2026-09-20T07:38:30.001Z');
    expect(offsetMinutes(withSeconds, MELB)).toBe(600);
    expect(toISO(floorToLocalSlot(withSeconds, MELB))).toBe('2026-09-20T07:30:00.000Z');
    expect(isAlignedToLocalSlot(floorToLocalSlot(withSeconds, MELB), MELB)).toBe(true);
  });

  it('keeps the occurrence when a wall time happens twice', () => {
    // Melbourne falls back on 2026-04-05: 03:00 becomes 02:00, so 02:15 happens
    // twice — once at +11 and once at +10. Going through toLocal and back lost
    // which one it was and always rebuilt the first, so the second 02:15
    // rounded *up* to forty-five minutes before itself.
    const first = fromISO('2026-04-04T15:15:00Z');
    const second = fromISO('2026-04-04T16:15:00Z');

    expect(toISO(ceilToLocalSlot(first, MELB))).toBe('2026-04-04T15:30:00.000Z');
    expect(toISO(floorToLocalSlot(first, MELB))).toBe('2026-04-04T15:00:00.000Z');

    expect(toISO(ceilToLocalSlot(second, MELB))).toBe('2026-04-04T16:30:00.000Z');
    expect(toISO(floorToLocalSlot(second, MELB))).toBe('2026-04-04T16:00:00.000Z');
  });

  it('never rounds a boundary past its input, in any zone or season', () => {
    // The guarantee the names make. A start that rounds backwards invents
    // availability; an end that rounds forwards does the same.
    const zones = [MELB, KATHMANDU, zone('Pacific/Chatham'), zone('UTC')];
    fc.assert(
      fc.property(
        fc.integer({ min: Date.parse('2026-01-01'), max: Date.parse('2027-01-01') }),
        fc.constantFrom(...zones),
        (millis, z) => {
          const value = instant(millis);
          expect(floorToLocalSlot(value, z)).toBeLessThanOrEqual(value);
          expect(ceilToLocalSlot(value, z)).toBeGreaterThanOrEqual(value);
          // And never further than a slot away.
          expect(value - floorToLocalSlot(value, z)).toBeLessThan(30 * MINUTE_MILLIS);
          expect(ceilToLocalSlot(value, z) - value).toBeLessThan(30 * MINUTE_MILLIS);
        },
      ),
    );
  });

  it('agrees with epoch rounding in an ordinary zone', () => {
    const ragged = fromLocal(DAY, 18 * 60 + 7, MELB);
    expect(floorToLocalSlot(ragged, MELB) % (30 * 60_000)).toBe(0);
    expect(ceilToLocalSlot(ragged, MELB) % (30 * 60_000)).toBe(0);
  });
});
