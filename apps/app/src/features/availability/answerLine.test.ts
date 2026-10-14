import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { answerLineOf, dayList } from './answerLine';
import type { BlockTiming } from './blocks';
import { dayRows, type RowWords } from './days';
import { editorReducer, emptyEditor, type EditorAction, type EditorState } from './editor';

/**
 * The one line under the grid (SUS-206, ADR 0068): which days, and what time
 * of day they all have. One day, three and eight; each time of day; a day
 * adjusted by the half hour; days that differ.
 */
const WORDS: RowWords = {
  cell: (day, from, to) => `${day}, ${from} to ${to}`,
  repeated: (label) => label,
  crossing: (label) => label,
  clocksGoBack: 'Clocks go back',
};
const TWELVE = { hour12: true };

/** Monday 12 to Sunday 25 October 2026, 9 am to 10:30 pm every day. */
const WHOLE_DAYS: PlanTiming = {
  window: { start: localDate('2026-10-12'), end: localDate('2026-10-25') },
  daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  zone: zone('Australia/Melbourne'),
};
const EVENINGS: PlanTiming = {
  ...WHOLE_DAYS,
  daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
};

function setUp(timing: BlockTiming) {
  const rows = dayRows(timing, TWELVE, WORDS, 'en-AU');
  const reduce = editorReducer(rows, timing);
  const run = (...actions: EditorAction[]): EditorState =>
    actions.reduce(reduce, emptyEditor(rows, timing));
  const line = (state: EditorState) => answerLineOf(state, rows, timing, TWELVE, 'en-AU');
  const tap = (...days: number[]) => days.map((day) => ({ type: 'toggle_day', day }) as const);
  return { run, line, tap };
}

describe('the answer line', () => {
  it('is nothing until a day is tapped', () => {
    const { run, line } = setUp(WHOLE_DAYS);

    expect(line(run())).toBeUndefined();
  });

  it('names one day and the evening', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(line(run(...tap(3)))).toEqual({
      days: 'Thu 15',
      time: 'Evenings, from 5:30 pm',
      shared: true,
    });
  });

  it('names three days in date order, as the artboard writes them', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    // Tapped out of order: Thu 22, Thu 15, Tue 20.
    expect(line(run(...tap(10, 3, 8)))).toEqual({
      days: 'Thu 15, Tue 20, Thu 22',
      time: 'Evenings, from 5:30 pm',
      shared: true,
    });
  });

  it('names three and counts the rest for eight days', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(line(run(...tap(0, 1, 2, 3, 4, 5, 6, 7)))).toEqual({
      days: 'Mon 12, Tue 13, Wed 14 and 5 more',
      time: 'Evenings, from 5:30 pm',
      shared: true,
    });
  });

  it('says the afternoon with its hours', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(line(run(...tap(1, 2), { type: 'set_window', kind: 'afternoon' }))).toEqual({
      days: 'Tue 13, Wed 14',
      time: 'Afternoons, 12–5 pm',
      shared: true,
    });
  });

  it('says any time that day on the whole band', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(line(run(...tap(1), { type: 'set_window', kind: 'any_time' }))?.time).toBe(
      'Any time that day',
    );
  });

  it('names the evening, not any time, where they are the same hours', () => {
    const { run, line, tap } = setUp(EVENINGS);

    expect(line(run(...tap(1)))?.time).toBe('Evenings, from 5:30 pm');
  });

  it('gives the hours of one day set by the half hour', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);
    const cells = new Array(27).fill(false).map((_, i) => i >= 20 && i < 24);

    expect(line(run(...tap(1), { type: 'paint', day: 1, cells }))).toEqual({
      days: 'Tue 13',
      time: '7–9 pm, set by the half hour',
      shared: true,
    });
  });

  it('gives the hours when every tapped day has the same hours that are not a block (review round 2)', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);
    const cells = new Array(27).fill(false).map((_, i) => i >= 20 && i < 24);

    expect(
      line(run(...tap(1, 2), { type: 'paint', day: 1, cells }, { type: 'paint', day: 2, cells })),
    ).toEqual({ days: 'Tue 13, Wed 14', time: '7–9 pm, set by the half hour', shared: true });
  });

  it('lists each day with its own time when they differ, as the board writes it', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);
    const nine = new Array(27).fill(false).map((_, i) => i >= 18 && i < 25);

    expect(
      line(
        run(
          ...tap(3, 8, 10),
          { type: 'set_day_window', day: 8, kind: 'afternoon' },
          { type: 'paint', day: 10, cells: nine },
        ),
      ),
    ).toEqual({
      days: 'Thu 15, Tue 20, Thu 22',
      time: 'Thu 15 evening, Tue 20 afternoon, Thu 22 6–9:30 pm',
      shared: false,
    });
  });

  it('names any time and the other times of day in the list too', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(
      line(run(...tap(1, 2), { type: 'set_day_window', day: 2, kind: 'any_time' }))?.time,
    ).toBe('Tue 13 evening, Wed 14 any time');
  });

  it('says one shared time is shared, so Change time is the sheet', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(line(run(...tap(1, 2)))?.shared).toBe(true);
  });
});

describe('a list of days', () => {
  it('joins two or three with "and" for the sheet, and with commas for the line', () => {
    expect(dayList(['Thu 15'], 'and')).toBe('Thu 15');
    expect(dayList(['Thu 15', 'Tue 20'], 'and')).toBe('Thu 15 and Tue 20');
    expect(dayList(['Thu 15', 'Tue 20', 'Thu 22'], 'and')).toBe('Thu 15, Tue 20 and Thu 22');
    expect(dayList(['Thu 15', 'Tue 20', 'Thu 22'], 'commas')).toBe('Thu 15, Tue 20, Thu 22');
  });

  it('counts the days past three', () => {
    expect(dayList(['a', 'b', 'c', 'd'], 'and')).toBe('a, b, c and 1 more');
    expect(dayList(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'commas')).toBe('a, b, c and 5 more');
  });
});
