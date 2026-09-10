import { describe, expect, it } from 'vitest';

import { MELBOURNE } from '../shared/fixtures.js';
import { interval } from '../shared/interval.js';
import { localDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';
import { formatMinutesOfDay, formatRange, rangeText } from './format.js';

const on = (fromMin: number, toMin: number) =>
  interval(
    fromLocal(localDate('2026-09-17'), fromMin, MELBOURNE),
    fromLocal(localDate('2026-09-17'), toMin, MELBOURNE),
  );

describe('formatMinutesOfDay', () => {
  it('drops the minutes on the hour', () => {
    expect(formatMinutesOfDay(19 * 60)).toBe('7 pm');
    expect(formatMinutesOfDay(19 * 60 + 30)).toBe('7:30 pm');
  });

  it('handles noon and midnight the way people say them', () => {
    expect(formatMinutesOfDay(12 * 60)).toBe('12 pm');
    expect(formatMinutesOfDay(0)).toBe('12 am');
  });

  it('writes 24-hour when asked', () => {
    expect(formatMinutesOfDay(19 * 60 + 30, { hour12: false })).toBe('19:30');
    expect(formatMinutesOfDay(9 * 60, { hour12: false })).toBe('09:00');
  });
});

describe('formatRange', () => {
  it('matches the spec examples', () => {
    expect(formatRange(18 * 60 + 30, 22 * 60 + 30)).toBe('6:30–10:30 pm');
    expect(formatRange(19 * 60, 21 * 60 + 30)).toBe('7–9:30 pm');
  });

  it('keeps both suffixes when the range crosses noon', () => {
    expect(formatRange(9 * 60 + 30, 14 * 60)).toBe('9:30 am–2 pm');
  });

  it('never assumes 12-hour', () => {
    expect(formatRange(18 * 60 + 30, 22 * 60 + 30, { hour12: false })).toBe('18:30–22:30');
  });
});

describe('rangeText', () => {
  it('is the day row header', () => {
    expect(rangeText([on(18 * 60 + 30, 22 * 60 + 30)], MELBOURNE)).toBe('6:30–10:30 pm');
  });

  it('lists two windows on one day', () => {
    expect(rangeText([on(9 * 60, 11 * 60), on(19 * 60, 21 * 60)], MELBOURNE)).toBe(
      '9–11 am, 7–9 pm',
    );
  });

  it('is undefined for a day with nothing painted, so the caller chooses the words', () => {
    expect(rangeText([], MELBOURNE)).toBeUndefined();
  });

  it('reads a window ending at midnight as midnight, not as 0:00 tomorrow', () => {
    const toMidnight = interval(
      fromLocal(localDate('2026-09-17'), 22 * 60, MELBOURNE),
      fromLocal(localDate('2026-09-18'), 0, MELBOURNE),
    );
    expect(rangeText([toMidnight], MELBOURNE)).toBe('10 pm–12 am');
  });
});
