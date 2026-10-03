import { fromISO, localDate } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import * as fixture from '../scheduling/fixtures';
import {
  canMoveEnd,
  existsOnClock,
  initialPick,
  instantsOf,
  isoOf,
  lastDay,
  lengthOf,
  moveEnd,
  moveStart,
  onDay,
  pickOf,
  problemOf,
} from './time';

const ZONE = 'Australia/Melbourne';
const NOW = fromISO('2026-09-10T00:00:00.000Z');
const friday = { day: localDate('2026-09-18'), startMin: 19 * 60, endMin: 21 * 60 };

describe('the picker clock (ADR 0050)', () => {
  it("turns a stretch on the plan's clock into instants, and back", () => {
    // Melbourne is UTC+10 in September: 7 pm is 09:00Z.
    expect(isoOf(friday, ZONE)).toEqual({
      startsAt: '2026-09-18T09:00:00.000Z',
      endsAt: '2026-09-18T11:00:00.000Z',
    });
    expect(pickOf('2026-09-18T09:00:00.000Z', '2026-09-18T11:00:00.000Z', ZONE)).toEqual(friday);
  });

  it('reads a stretch that crosses midnight as an end past 24:00', () => {
    const late = pickOf('2026-09-18T12:00:00.000Z', '2026-09-18T15:00:00.000Z', ZONE);
    // 10 pm to 1 am.
    expect(late).toEqual({ day: '2026-09-18', startMin: 22 * 60, endMin: 25 * 60 });
    expect(instantsOf(late, ZONE).end).toBe(fromISO('2026-09-18T15:00:00.000Z'));
  });

  it('keeps the length when the start moves, and changes it when the end does', () => {
    expect(lengthOf(moveStart(friday, 1))).toBe(120);
    expect(moveStart(friday, 1).startMin).toBe(19 * 60 + 30);
    expect(moveEnd(friday, 1).endMin).toBe(21 * 60 + 30);
    expect(lengthOf(moveEnd(friday, 1))).toBe(150);
  });

  it('stops at the lengths the product allows and at the ends of the day', () => {
    const shortest = { ...friday, endMin: friday.startMin + 30 };
    expect(canMoveEnd(shortest, -1)).toBe(false);
    const longest = { ...friday, endMin: friday.startMin + 300 };
    expect(canMoveEnd(longest, 1)).toBe(false);
    expect(moveStart({ day: friday.day, startMin: 0, endMin: 120 }, -1).startMin).toBe(0);
    expect(
      moveStart({ day: friday.day, startMin: 23 * 60 + 30, endMin: 25 * 60 }, 1).startMin,
    ).toBe(23 * 60 + 30);
  });

  it("asks the domain what is wrong with a stretch, in the plan's own terms", () => {
    const plan = fixture.ready;
    expect(problemOf(plan, friday, NOW)).toBeUndefined();
    expect(problemOf(plan, onDay(friday, localDate('2026-09-09')), NOW)).toBe(
      'own_time_in_the_past',
    );
    expect(problemOf(plan, onDay(friday, localDate('2026-10-21')), NOW)).toBe(
      'own_time_too_far_ahead',
    );
    expect(lastDay(plan)).toBe('2026-10-20');
  });
});

describe('where the picker opens', () => {
  it('on the option that was selected, when one was chosen', () => {
    const chosen = { startsAt: '2026-09-19T08:30:00.000Z', endsAt: '2026-09-19T10:30:00.000Z' };
    expect(initialPick(fixture.ready, NOW, chosen)).toEqual({
      day: '2026-09-19',
      startMin: 18 * 60 + 30,
      endMin: 20 * 60 + 30,
    });
  });

  it('on the best option when nothing was chosen', () => {
    expect(initialPick(fixture.ready, NOW).day).toBe('2026-09-17');
  });

  it('on the closest near-miss when there are no options', () => {
    const miss = fixture.noQuorum.nearMisses[0]!;
    const open = initialPick(fixture.noQuorum, NOW);
    expect(open).toEqual(pickOf(miss.startsAt, miss.endsAt, ZONE));
  });

  it('on the first day the plan asks about that is still ahead, with nothing to start from', () => {
    const open = initialPick(fixture.waiting, NOW);
    // The plan asks about 14 to 20 September; the band opens 5:30 pm; two hours.
    expect(open).toEqual({ day: '2026-09-14', startMin: 17 * 60 + 30, endMin: 19 * 60 + 30 });
  });

  it('on tomorrow when every day the plan asks about has gone', () => {
    const late = fromISO('2026-09-30T00:00:00.000Z');
    expect(initialPick(fixture.waiting, late).day).toBe('2026-10-01');
  });
});

describe('a time the clock never reads', () => {
  it('is not offered on the day clocks go forward, and is on any other', () => {
    // Melbourne's clocks go from 2 am to 3 am on 4 October 2026.
    const gap = { day: localDate('2026-10-04'), startMin: 150, endMin: 210 };
    expect(existsOnClock(gap, ZONE)).toBe(false);
    expect(existsOnClock({ ...gap, startMin: 180, endMin: 240 }, ZONE)).toBe(true);
    expect(existsOnClock({ ...gap, day: localDate('2026-10-05') }, ZONE)).toBe(true);
    // And an end past midnight is read on the next day.
    expect(existsOnClock({ ...friday, endMin: 25 * 60 }, ZONE)).toBe(true);
  });
});
