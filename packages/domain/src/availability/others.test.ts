import { describe, expect, it } from 'vitest';

import { plan } from '../planning/fixtures.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { type Interval, interval } from '../shared/interval.js';
import { localDate, type LocalDate } from '../shared/local-date.js';
import { fromLocal, zone, type Zone } from '../shared/zone.js';
import { cellsFor } from './cells.js';
import {
  HOURS_THRESHOLD,
  OTHERS_THRESHOLD,
  cellCounts,
  dayCountsOf,
  dayFreeCount,
  freeFor,
  freeStretches,
  headcount,
  hoursShown,
  othersShown,
  peakOf,
  type OthersSaid,
} from './others.js';

const THU = localDate('2026-09-17');
const FRI = localDate('2026-09-18');

/** A window from local minutes to local minutes on a day, in Melbourne unless said. */
function at(date: LocalDate, from: number, to: number, z: Zone = MELBOURNE): Interval {
  return interval(fromLocal(date, from, z), fromLocal(date, to, z));
}

const H = (hours: number, minutes = 0) => hours * 60 + minutes;

function said(overrides: Partial<OthersSaid> = {}): OthersSaid {
  return {
    asked: 6,
    answered: 0,
    withTimes: 0,
    flexible: 0,
    readerAnswered: false,
    dayCounts: [],
    days: [],
    ...overrides,
  };
}

describe('othersShown', () => {
  it('is one other with times: the founder chose one, and with one the counts are their answer', () => {
    expect(OTHERS_THRESHOLD).toBe(1);
    expect(
      othersShown(said({ answered: 1, withTimes: 1, dayCounts: [{ date: THU, count: 1 }] })),
    ).toBe(true);
  });

  it('is not met by nobody', () => {
    expect(othersShown(said())).toBe(false);
  });

  it('is not met by "I\'m easy" answers alone, which would put one number on every day', () => {
    expect(othersShown(said({ answered: 3, flexible: 3 }))).toBe(false);
  });

  it('is not met by answers that say no', () => {
    // "None work", "more notice" and "not this time" are answers, not times.
    expect(othersShown(said({ answered: 2 }))).toBe(false);
  });
});

describe('hoursShown (SUS-211)', () => {
  const windows = [[at(THU, H(18), H(20))]];

  it('waits for two others with times: the founder chose it on 15 October 2026', () => {
    expect(HOURS_THRESHOLD).toBe(2);
    expect(OTHERS_THRESHOLD).toBe(1);
  });

  it('is not met by one other: their hours would be their whole answer', () => {
    expect(hoursShown(said({ answered: 1, withTimes: 1, days: windows }))).toBe(false);
  });

  it('is not met by one other with times and another who said "I\'m easy"', () => {
    // Two have answered, but the only hours there are belong to one person.
    expect(hoursShown(said({ answered: 2, withTimes: 1, flexible: 1, days: windows }))).toBe(false);
  });

  it('is met by two others with times, and needs the hours to have arrived', () => {
    const two = said({ answered: 2, withTimes: 2, days: [windows[0]!, windows[0]!] });
    expect(hoursShown(two)).toBe(true);
    expect(hoursShown({ ...two, days: [] })).toBe(false);
  });
});

describe('dayFreeCount and dayCountsOf (SUS-211)', () => {
  it('counts a day from the day counts alone, with no hours', () => {
    const one = said({
      answered: 1,
      withTimes: 1,
      dayCounts: [
        { date: THU, count: 1 },
        { date: FRI, count: 1 },
      ],
    });
    expect(one.days).toEqual([]);
    expect(dayFreeCount(one, THU)).toBe(1);
    expect(dayFreeCount(one, localDate('2026-09-19'))).toBe(0);
  });

  it('adds everyone who said "I\'m easy" to every day', () => {
    expect(dayFreeCount(said({ flexible: 2, dayCounts: [{ date: THU, count: 1 }] }), THU)).toBe(3);
    expect(dayFreeCount(said({ flexible: 2 }), FRI)).toBe(2);
  });

  it("works out the counts the database sends from each person's day, one per person per day", () => {
    expect(
      dayCountsOf(
        [
          [at(THU, H(18), H(19)), at(THU, H(20), H(21))],
          [at(THU, H(18, 30), H(20, 30))],
          [at(FRI, H(18, 30), H(20, 30))],
        ],
        MELBOURNE,
      ),
    ).toEqual([
      { date: THU, count: 2 },
      { date: FRI, count: 1 },
    ]);
  });
});

describe('freeFor', () => {
  // Nina 6–7, Tom 8–9 on Thursday; Jess Thursday 6:30–8:30 and Friday.
  const others = said({
    answered: 3,
    withTimes: 3,
    days: [
      [at(THU, H(18), H(19))],
      [at(THU, H(20), H(21))],
      [at(THU, H(18, 30), H(20, 30))],
      [at(FRI, H(18, 30), H(20, 30))],
    ],
  });

  it('counts each person with any half hour in common, not the most at once', () => {
    // 6–9 pm meets all three on Thursday, though no half hour has more than two.
    expect(freeFor(others, [at(THU, H(18), H(21))])).toBe(3);
  });

  it('counts a person once however many of their half hours the spans meet', () => {
    expect(freeFor(others, [at(THU, H(18), H(18, 30)), at(THU, H(18, 30), H(19))])).toBe(2);
  });

  it('does not count a window that only touches the span at its end', () => {
    // Nina stops at 7; a span from 7 shares no half hour with her.
    expect(freeFor(others, [at(THU, H(19), H(19, 30))])).toBe(1);
  });

  it('keeps one day to itself: Friday is not Thursday', () => {
    expect(freeFor(others, [at(FRI, H(17, 30), H(22, 30))])).toBe(1);
  });

  it('adds everyone who said "I\'m easy" to any span, and nobody to none', () => {
    const easy = { ...others, flexible: 2 };
    expect(freeFor(easy, [at(THU, H(22), H(22, 30))])).toBe(2);
    expect(freeFor(easy, [at(THU, H(18), H(21))])).toBe(5);
    expect(freeFor(easy, [])).toBe(0);
  });
});

describe('cellCounts and peakOf', () => {
  it('counts each half hour of the day, and finds the most and where', () => {
    const p = plan();
    const cells = cellsFor(THU, p);
    const counts = cellCounts(
      said({
        withTimes: 2,
        days: [[at(THU, H(18, 30), H(20, 30))], [at(THU, H(19), H(21))]],
      }),
      cells,
    );
    // 5:30 … 10 pm, ten cells.
    expect(counts).toEqual([0, 0, 1, 2, 2, 2, 1, 0, 0, 0]);
    expect(peakOf(counts)).toEqual({ most: 2, runs: [{ from: 3, to: 6 }] });
  });

  it('gives every run at the most, not just the first', () => {
    expect(peakOf([1, 3, 3, 0, 3, 1])).toEqual({
      most: 3,
      runs: [
        { from: 1, to: 3 },
        { from: 4, to: 5 },
      ],
    });
  });

  it('is nothing on a day nobody picked', () => {
    expect(peakOf([0, 0, 0])).toEqual({ most: 0, runs: [] });
  });

  it('counts the half hours that happen on the night the clocks go forward', () => {
    // Melbourne, Sunday 4 October 2026: 2 am becomes 3 am. A 1–4 am band has
    // four real half hours, not six, and a window over the gap is still one
    // person in each of them.
    const night = localDate('2026-10-04');
    const p = plan({ daily: { startMin: H(1), endMin: H(4) } });
    const cells = cellsFor(night, p);
    expect(cells).toHaveLength(4);
    const window = interval(cells[0]!.start, cells[3]!.end);
    expect(cellCounts(said({ withTimes: 1, days: [[window]] }), cells)).toEqual([1, 1, 1, 1]);
  });

  it('counts by the plan’s own half hours in a zone off the half hour', () => {
    // Kathmandu is UTC+5:45, so its half hours are not the epoch's.
    const kathmandu = zone('Asia/Kathmandu');
    const p = plan({ zone: kathmandu });
    const cells = cellsFor(THU, p);
    const counts = cellCounts(
      said({ withTimes: 1, days: [[at(THU, H(18), H(19), kathmandu)]] }),
      cells,
    );
    expect(counts).toEqual([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('headcount (SUS-206)', () => {
  it('is the others alone until the reader taps the day', () => {
    expect(headcount(3, false)).toBe(3);
  });

  it('counts the reader once they tap: 3 others become 4, and untapping gives 3 back', () => {
    expect(headcount(3, true)).toBe(4);
    expect(headcount(headcount(3, true) - 1, false)).toBe(3);
  });

  it('is 1 for the reader alone on a day nobody else could make, and 0 untapped', () => {
    expect(headcount(0, true)).toBe(1);
    expect(headcount(0, false)).toBe(0);
  });

  it('never goes below zero', () => {
    expect(headcount(-2, false)).toBe(0);
  });
});

describe('freeStretches (SUS-206)', () => {
  it('is nothing when nobody else is free at any time that day', () => {
    expect(freeStretches([0, 0, 0, 0])).toEqual([]);
    expect(freeStretches([])).toEqual([]);
  });

  it('is the cells at the most, as one stretch when they are adjacent', () => {
    expect(freeStretches([1, 3, 3, 3, 1, 0])).toEqual([{ from: 1, to: 4 }]);
  });

  it('includes cells near the most: three quarters of it, rounded up', () => {
    // The most is 4, so 3 counts and 2 does not.
    expect(freeStretches([2, 3, 4, 3, 2])).toEqual([{ from: 1, to: 4 }]);
    // The most is 2, so 2 only (ceil of 1.5), and a lone 1 is out.
    expect(freeStretches([1, 2, 2, 1])).toEqual([{ from: 1, to: 3 }]);
  });

  it('gives two stretches with a gap between, in time order', () => {
    expect(freeStretches([3, 3, 1, 1, 3, 3, 3, 0])).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 7 },
    ]);
  });

  it('is at least one other: a day only one other is free on shows that one stretch', () => {
    expect(freeStretches([0, 1, 1, 0])).toEqual([{ from: 1, to: 3 }]);
  });

  it('keeps the three longest stretches past three, still in time order', () => {
    const counts = [3, 0, 3, 3, 0, 3, 0, 3, 3, 3, 0, 3];
    expect(freeStretches(counts)).toEqual(
      [
        { from: 2, to: 4 },
        { from: 7, to: 10 },
        { from: 0, to: 1 },
      ].sort((a, b) => a.from - b.from),
    );
  });
});
