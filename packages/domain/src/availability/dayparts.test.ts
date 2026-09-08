import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { interval } from '../shared/interval.js';
import { localDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';
import { dayPartOf, summariseDayparts } from './dayparts.js';
import { response } from './fixtures.js';

/** 17 Sep 2026 is a Thursday; 19 Sep is a Saturday. */
const WEEKDAY = '2026-09-17';
const WEEKEND = '2026-09-19';

const on = (date: string, fromMin: number, toMin: number) =>
  interval(
    fromLocal(localDate(date), fromMin, MELBOURNE),
    fromLocal(localDate(date), toMin, MELBOURNE),
  );

describe('dayPartOf', () => {
  it('splits the day at noon and five', () => {
    expect(dayPartOf(on(WEEKDAY, 10 * 60, 11 * 60), MELBOURNE)).toBe('weekday_morning');
    expect(dayPartOf(on(WEEKDAY, 13 * 60, 14 * 60), MELBOURNE)).toBe('weekday_afternoon');
    expect(dayPartOf(on(WEEKDAY, 19 * 60, 20 * 60), MELBOURNE)).toBe('weekday_evening');
  });

  it('knows a weekend', () => {
    expect(dayPartOf(on(WEEKEND, 10 * 60, 11 * 60), MELBOURNE)).toBe('weekend_morning');
    expect(dayPartOf(on(WEEKEND, 19 * 60, 20 * 60), MELBOURNE)).toBe('weekend_evening');
  });

  it('classifies by the local day, not by UTC', () => {
    // 08:00Z on the 17th is 18:00 Melbourne — a weekday evening, not a morning.
    const utcMorning = interval(
      fromLocal(localDate(WEEKDAY), 18 * 60, MELBOURNE),
      fromLocal(localDate(WEEKDAY), 19 * 60, MELBOURNE),
    );
    expect(dayPartOf(utcMorning, MELBOURNE)).toBe('weekday_evening');
  });
});

describe('summariseDayparts', () => {
  const ann = userId('ann');
  const bo = userId('bo');

  it('puts the most-offered part first', () => {
    const summaries = summariseDayparts(
      [
        response({
          userId: ann,
          windows: [on(WEEKDAY, 19 * 60, 20 * 60), on(WEEKDAY, 20 * 60, 21 * 60)],
        }),
        response({ userId: ann, revision: 2, windows: [on(WEEKEND, 10 * 60, 11 * 60)] }),
      ],
      MELBOURNE,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.parts[0]).toBe('weekday_evening');
    expect(summaries[0]?.counts.weekday_evening).toBe(2);
    expect(summaries[0]?.counts.weekend_morning).toBe(1);
  });

  it('summarises each member separately', () => {
    const summaries = summariseDayparts(
      [
        response({ userId: ann, windows: [on(WEEKDAY, 19 * 60, 20 * 60)] }),
        response({ userId: bo, windows: [on(WEEKEND, 10 * 60, 11 * 60)] }),
      ],
      MELBOURNE,
    );
    expect(summaries.map((s) => s.userId).sort()).toEqual([ann, bo]);
  });

  it('leaves out a member with no pattern rather than reporting zeroes', () => {
    // "No pattern yet" and "a pattern of nothing" are different: only the first
    // should fall back to the plan defaults.
    const summaries = summariseDayparts(
      [
        response({ userId: ann, status: 'flexible' }),
        response({ userId: bo, status: 'not_this_time' }),
      ],
      MELBOURNE,
    );
    expect(summaries).toEqual([]);
  });

  it('ignores a windows response that carries none', () => {
    expect(summariseDayparts([response({ userId: ann, windows: [] })], MELBOURNE)).toEqual([]);
  });

  it('breaks ties in a fixed order, so the pre-fill is deterministic', () => {
    const summaries = summariseDayparts(
      [
        response({
          userId: ann,
          windows: [on(WEEKDAY, 10 * 60, 11 * 60), on(WEEKDAY, 19 * 60, 20 * 60)],
        }),
      ],
      MELBOURNE,
    );
    expect(summaries[0]?.parts).toEqual(['weekday_morning', 'weekday_evening']);
  });
});
