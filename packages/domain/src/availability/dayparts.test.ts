import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { interval } from '../shared/interval.js';
import { localDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';
import { dayPartOf, dayPartsCovered, summariseDayparts } from './dayparts.js';
import { response } from './fixtures.js';

/** 17 Sep 2026 is a Thursday; 19 Sep is a Saturday. */
const WEEKDAY = '2026-09-17';
const WEEKEND = '2026-09-19';

const on = (date: string, fromMin: number, toMin: number) =>
  interval(
    fromLocal(localDate(date), fromMin, MELBOURNE),
    fromLocal(localDate(date), toMin, MELBOURNE),
  );

/**
 * The rule exists twice — here, and as `jobs.daypart_counts` /
 * `jobs.daypart_summary` in SQL, because retention has to write the summary in
 * the same transaction that deletes the windows it summarises (ADR 0005,
 * ADR 0014). Two implementations of one rule is the shape this repo has been
 * bitten by, so they are pinned to the same case: the same weekday and weekend
 * days, the same clock times in the same zone, and the same expected result as
 * `supabase/tests/database/080_retention.sql` asserts against the database.
 * (That suite dates its fixtures 2099 so they cannot expire; these are 2026.
 * Both are a Thursday and a Saturday in Melbourne, which is what the rule
 * reads.) Change the rule on either side and the other suite fails.
 */
describe('the summary SQL also has to produce', () => {
  it('a Thursday evening and a Saturday morning-into-afternoon', () => {
    const summaries = summariseDayparts(
      [
        response({
          windows: [on(WEEKDAY, 17 * 60 + 30, 19 * 60 + 30), on(WEEKEND, 10 * 60, 13 * 60)],
        }),
      ],
      MELBOURNE,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.parts).toEqual([
      'weekday_evening',
      'weekend_morning',
      'weekend_afternoon',
    ]);
    expect(summaries[0]?.counts).toEqual({
      weekday_morning: 0,
      weekday_afternoon: 0,
      weekday_evening: 1,
      weekend_morning: 1,
      weekend_afternoon: 1,
      weekend_evening: 0,
    });
  });
});

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

describe('dayPartsCovered', () => {
  it('counts every part a window spans, not only the one it starts in', () => {
    // "Any time that day" on a weekend plan. Recording only the morning would
    // pre-fill the next plan with a third of what the person offered, and the
    // omission would look like a preference.
    expect(dayPartsCovered(on(WEEKDAY, 9 * 60, 22 * 60 + 30), MELBOURNE)).toEqual([
      'weekday_morning',
      'weekday_afternoon',
      'weekday_evening',
    ]);
  });

  it('is a single part for a window inside one', () => {
    expect(dayPartsCovered(on(WEEKDAY, 19 * 60, 21 * 60), MELBOURNE)).toEqual(['weekday_evening']);
  });

  it('does not count a part the window merely touches the boundary of', () => {
    // Ending exactly at noon is a morning, not a morning and an afternoon:
    // intervals are half-open.
    expect(dayPartsCovered(on(WEEKDAY, 10 * 60, 12 * 60), MELBOURNE)).toEqual(['weekday_morning']);
  });

  it('spans two parts when it crosses one boundary', () => {
    expect(dayPartsCovered(on(WEEKDAY, 11 * 60, 13 * 60), MELBOURNE)).toEqual([
      'weekday_morning',
      'weekday_afternoon',
    ]);
  });

  it('uses the weekend prefix on a weekend', () => {
    expect(dayPartsCovered(on(WEEKEND, 9 * 60, 22 * 60), MELBOURNE)).toEqual([
      'weekend_morning',
      'weekend_afternoon',
      'weekend_evening',
    ]);
  });
});

describe('summariseDayparts', () => {
  const ann = userId('ann');
  const bo = userId('bo');

  it('records every part of a wide window, so the pre-fill is not a third of the answer', () => {
    const summaries = summariseDayparts(
      [response({ userId: ann, windows: [on(WEEKDAY, 9 * 60, 22 * 60 + 30)] })],
      MELBOURNE,
    );
    expect(summaries[0]?.parts).toEqual([
      'weekday_morning',
      'weekday_afternoon',
      'weekday_evening',
    ]);
  });

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

  it('cannot be handed a withdrawal that still carries windows', () => {
    // The union makes it a compile error, which is the point: a caller
    // switching someone from `windows` to `not_this_time` without clearing the
    // array would otherwise persist availability they had just withdrawn.
    // @ts-expect-error `not_this_time` carries no windows
    response({ userId: ann, status: 'not_this_time', windows: [on(WEEKDAY, 19 * 60, 20 * 60)] });
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
