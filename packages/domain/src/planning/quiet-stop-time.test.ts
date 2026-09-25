import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { MELBOURNE } from '../shared/fixtures.js';
import { type Instant, addMinutes, instant } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';
import { lastPossibleStart } from './deadline.js';
import { FRIDAY_MIDDAY, TOM_ASKS } from './fixtures.js';
import { resolvePreset } from './presets.js';
import {
  type QuietPreset,
  QUIET_PRESETS,
  isQuietPreset,
  isValidStopTime,
  resolveStopTime,
  stopTimeOptions,
} from './quiet-stop-time.js';
import type { DurationMinutes, PlanTiming } from './types.js';

function timingFor(preset: QuietPreset, now: Instant, durationMinutes: DurationMinutes = 120) {
  const resolved = resolvePreset(preset, now, MELBOURNE, { durationMinutes });
  if (typeof resolved === 'string') throw new Error(resolved);
  return { ...resolved, durationMinutes, zone: MELBOURNE } satisfies PlanTiming;
}

const at = (date: string, minutes: number) => fromLocal(localDate(date), minutes, MELBOURNE);
const options = (preset: QuietPreset, now: Instant, duration?: DurationMinutes) =>
  stopTimeOptions(preset, now, timingFor(preset, now, duration));

describe('isValidStopTime', () => {
  const weekend = timingFor('this_weekend', TOM_ASKS);

  it('Friday midday for a weekend ask made on Tuesday is valid', () => {
    expect(isValidStopTime(FRIDAY_MIDDAY, TOM_ASKS, weekend)).toBe(true);
  });

  it('a stop time at or after the last possible start is invalid', () => {
    const last = lastPossibleStart(weekend);
    expect(isValidStopTime(last, TOM_ASKS, weekend)).toBe(false);
    expect(isValidStopTime(addMinutes(last, 30), TOM_ASKS, weekend)).toBe(false);
    expect(isValidStopTime(addMinutes(last, -1), TOM_ASKS, weekend)).toBe(true);
  });

  it('a stop time now or in the past is invalid', () => {
    expect(isValidStopTime(TOM_ASKS, TOM_ASKS, weekend)).toBe(false);
    expect(isValidStopTime(addMinutes(TOM_ASKS, -1), TOM_ASKS, weekend)).toBe(false);
  });
});

describe('stopTimeOptions', () => {
  it('a weekend ask on Tuesday offers tonight, Friday midday and the weekend starting, Friday first', () => {
    const { options: offered, preferred } = options('this_weekend', TOM_ASKS);
    expect(offered.map((o) => o.option)).toEqual([
      'tonight_9pm',
      'friday_midday',
      'when_window_starts',
    ]);
    expect(preferred?.option).toBe('friday_midday');
    expect(preferred?.at).toBe(FRIDAY_MIDDAY);
    expect(offered[2]?.at).toBe(at('2026-09-19', 9 * 60));
  });

  it('a weekend ask on Friday afternoon has lost Friday midday', () => {
    const friday = at('2026-09-18', 13 * 60);
    const offered = options('this_weekend', friday).options.map((o) => o.option);
    expect(offered).toEqual(['tonight_9pm', 'when_window_starts']);
  });

  it('a weekend ask on Saturday has no Friday in front of it, and its window has started', () => {
    const saturday = at('2026-09-19', 10 * 60);
    const offered = options('this_weekend', saturday).options.map((o) => o.option);
    expect(offered).toEqual(['tonight_9pm']);
  });

  it('a tonight ask stops at 9 pm while a two-hour meetup can still start after it', () => {
    const evening = at('2026-09-15', 17 * 60 + 10);
    const { options: offered, preferred } = options('tonight', evening);
    // Tonight runs 17:30–23:30, so a two-hour meetup can start until 21:30.
    expect(offered.map((o) => o.option)).toEqual(['tonight_9pm', 'when_window_starts']);
    expect(preferred?.at).toBe(at('2026-09-15', 21 * 60));
  });

  it('a tonight ask for three hours cannot stop at 9 pm: the last start is 8:30', () => {
    const evening = at('2026-09-15', 17 * 60 + 10);
    const { options: offered, preferred } = options('tonight', evening, 180);
    expect(offered.map((o) => o.option)).toEqual(['when_window_starts']);
    expect(preferred?.at).toBe(at('2026-09-15', 17 * 60 + 30));
  });

  it('a week or a fortnight prefers two days', () => {
    for (const preset of ['next_7_days', 'next_14_days'] as const) {
      const { options: offered, preferred } = options(preset, TOM_ASKS);
      expect(offered.map((o) => o.option)).toEqual([
        'tonight_9pm',
        'two_days',
        'when_window_starts',
      ]);
      expect(preferred?.at).toBe(addMinutes(TOM_ASKS, 48 * 60));
    }
  });

  it('two days is forty-eight hours of asking across a clock change', () => {
    // Melbourne moves to daylight time on Sunday 4 October 2026.
    const saturday = at('2026-10-03', 10 * 60);
    const two = options('next_7_days', saturday).options.find((o) => o.option === 'two_days');
    expect(two?.at).toBe(addMinutes(saturday, 48 * 60));
  });

  it('offers nothing at all when no stop time fits', () => {
    // 21:10: 9 pm has gone, and tonight's band opens at 21:30, which is also the
    // last a two-hour meetup can start. A named plan could still be made; a quiet
    // ask has no moment left to stop asking in.
    const late = at('2026-09-15', 21 * 60 + 10);
    const { options: offered, preferred } = options('tonight', late);
    expect(offered).toEqual([]);
    expect(preferred).toBeUndefined();
  });

  it('every offered stop time is valid, for any moment and any quiet window', () => {
    const start = at('2026-09-01', 0);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 * 24 * 60 }),
        fc.constantFrom(...QUIET_PRESETS),
        fc.constantFrom<DurationMinutes>(60, 120, 180),
        (offset, preset, duration) => {
          const now = instant(start + offset * 60_000);
          const resolved = resolvePreset(preset, now, MELBOURNE, { durationMinutes: duration });
          if (typeof resolved === 'string') return;
          const timing = { ...resolved, durationMinutes: duration, zone: MELBOURNE };
          for (const choice of stopTimeOptions(preset, now, timing).options) {
            expect(isValidStopTime(choice.at, now, timing)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('resolveStopTime', () => {
  it('resolves an offered option and refuses one the window does not offer', () => {
    const week = timingFor('next_7_days', TOM_ASKS);
    expect(resolveStopTime('next_7_days', 'two_days', TOM_ASKS, week)).toBe(
      addMinutes(TOM_ASKS, 48 * 60),
    );
    expect(resolveStopTime('next_7_days', 'friday_midday', TOM_ASKS, week)).toBeUndefined();
  });
});

describe('isQuietPreset', () => {
  it('a quiet ask has four windows and no custom one', () => {
    expect(isQuietPreset('custom')).toBe(false);
    for (const preset of QUIET_PRESETS) expect(isQuietPreset(preset)).toBe(true);
  });
});
