import { formatMinutesOfDay, formatRange, fromISO, zone as toZone } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { clockTime, hoursSpan, timeRange } from './format.ts';

/**
 * The letter, the share text (`share-messages.test.ts`) and the app write a time of day with one function
 * (SUS-217). A letter cannot know the reader's clock, so it writes the
 * 12-hour "6:30 pm" the app writes by default; these pin that to the domain's
 * rules so a drift in either shows up here.
 */
const MELBOURNE = toZone('Australia/Melbourne');
const START = fromISO('2026-09-17T08:30:00Z'); // 6:30 pm in Melbourne
const END = fromISO('2026-09-17T10:30:00Z'); // 8:30 pm

describe('the clock in a letter', () => {
  it('is the domain 12-hour rule', () => {
    expect(clockTime(START, MELBOURNE)).toBe('6:30 pm');
    expect(clockTime(START, MELBOURNE)).toBe(formatMinutesOfDay(18 * 60 + 30, { hour12: true }));
    expect(timeRange(START, END, MELBOURNE)).toBe('6:30–8:30 pm');
    expect(hoursSpan(17 * 60 + 30, 22 * 60 + 30)).toBe(
      formatRange(17 * 60 + 30, 22 * 60 + 30, { hour12: true }),
    );
  });

  it('reads a range ending at midnight as ending at midnight', () => {
    const late = fromISO('2026-09-17T14:00:00Z'); // midnight in Melbourne
    expect(timeRange(START, late, MELBOURNE)).toBe('6:30 pm–12 am');
  });
});
