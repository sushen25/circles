import { describe, expect, it } from 'vitest';

import { plan } from '../planning/fixtures.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { type Interval, interval } from '../shared/interval.js';
import { localDate, type LocalDate } from '../shared/local-date.js';
import { fromLocal, zone, type Zone } from '../shared/zone.js';
import { cellsFor } from './cells.js';
import {
  OTHERS_THRESHOLD,
  cellCounts,
  freeFor,
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
    days: [],
    ...overrides,
  };
}

describe('othersShown', () => {
  it('is one other with times: the founder chose one, and with one the counts are their answer', () => {
    expect(OTHERS_THRESHOLD).toBe(1);
    expect(othersShown(said({ answered: 1, withTimes: 1, days: [[at(THU, H(18), H(20))]] }))).toBe(
      true,
    );
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

describe('freeFor', () => {
  // Priya 6–7, Tom 8–9 on Thursday; Jess Thursday 6:30–8:30 and Friday.
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
    // Priya stops at 7; a span from 7 shares no half hour with her.
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
