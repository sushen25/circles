import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { answerLineOf, dayList } from './answerLine';
import { bandName, onlyChoice, type BlockTiming } from './blocks';
import { dayRows } from './days';
import { editorReducer, emptyEditor, type EditorAction, type EditorState } from './editor';

/**
 * The one line under the grid (SUS-206, ADR 0068): which days, and what time
 * of day they all have. One day, three and eight; each time of day; a day
 * adjusted by the half hour; days that differ.
 */
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
  const rows = dayRows(timing, 'en-AU');
  const reduce = editorReducer(rows, timing);
  const run = (...actions: EditorAction[]): EditorState =>
    actions.reduce(reduce, emptyEditor(rows, timing));
  // As the screen does: on a plan with one window the band names it.
  const band = onlyChoice(rows, timing) === undefined ? undefined : bandName(timing);
  const line = (state: EditorState) => answerLineOf(state, rows, timing, TWELVE, 'en-AU', band);
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

  it('says daytime with its hours', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(line(run(...tap(1, 2), { type: 'set_window', kind: 'daytime' }))).toEqual({
      days: 'Tue 13, Wed 14',
      time: 'Daytime, 9 am–5 pm',
      shared: true,
    });
  });

  it('names the band on a plan with one window: mornings, afternoons, evenings', () => {
    const at = (startMin: number, endMin: number) =>
      setUp({ ...WHOLE_DAYS, daily: { startMin, endMin } });
    for (const [band, time] of [
      [[9 * 60, 12 * 60], 'Mornings, 9 am–12 pm'],
      [[12 * 60, 17 * 60], 'Afternoons, 12–5 pm'],
      [[17 * 60 + 30, 22 * 60 + 30], 'Evenings, from 5:30 pm'],
    ] as const) {
      const { run, line, tap } = at(band[0], band[1]);
      expect(line(run(...tap(1, 2)))?.time).toBe(time);
    }
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

  describe('days that differ: the time most share, then the exceptions (SUS-206)', () => {
    const nine = new Array(27).fill(false).map((_, i) => i >= 18 && i < 25);

    it('names one exception, as the board writes it', () => {
      const { run, line, tap } = setUp(WHOLE_DAYS);

      expect(
        line(run(...tap(3, 8), { type: 'set_day_window', day: 8, kind: 'daytime' })),
      ).toMatchObject({
        days: 'Thu 15, Tue 20',
        time: 'Evenings, but daytime on Tue 20',
        shared: false,
      });
    });

    it('names three exceptions together: "Evenings, but daytime on Tue 20 and 6–9:30 pm on Thu 22"', () => {
      const { run, line, tap } = setUp(WHOLE_DAYS);

      expect(
        line(
          run(
            ...tap(3, 8, 10, 4),
            { type: 'set_day_window', day: 8, kind: 'daytime' },
            { type: 'paint', day: 10, cells: nine },
          ),
        )?.time,
      ).toBe('Evenings, but daytime on Tue 20 and 6–9:30 pm on Thu 22');
    });

    it('says two days with the same exception as one: "daytime on Tue 20 and Wed 21"', () => {
      const { run, line, tap } = setUp(WHOLE_DAYS);

      expect(
        line(
          run(
            ...tap(3, 4, 8, 9),
            { type: 'set_day_window', day: 8, kind: 'daytime' },
            { type: 'set_day_window', day: 9, kind: 'daytime' },
          ),
        )?.time,
      ).toBe('Evenings, but daytime on Tue 20 and Wed 21');
    });

    it('turns to counts past three exceptions: "8 evenings, 4 daytimes"', () => {
      const { run, line, tap } = setUp(WHOLE_DAYS);
      const days = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

      expect(
        line(
          run(
            ...tap(...days),
            ...[8, 9, 10, 11].map(
              (day) => ({ type: 'set_day_window', day, kind: 'daytime' }) as const,
            ),
          ),
        )?.time,
      ).toBe('8 evenings, 4 daytimes');
    });

    it('names exceptions by hours too, and one exception in the singular', () => {
      const { run, line, tap } = setUp(WHOLE_DAYS);

      expect(
        line(run(...tap(0, 1, 2, 3), { type: 'set_day_window', day: 3, kind: 'daytime' }))?.time,
      ).toBe('Evenings, but daytime on Thu 15');
      expect(
        line(
          run(
            ...tap(0, 1, 2, 3, 4),
            { type: 'paint', day: 3, cells: nine },
            { type: 'paint', day: 4, cells: nine },
          ),
        )?.time,
      ).toBe('Evenings, but 6–9:30 pm on Thu 15 and Fri 16');
    });

    it('goes to the time the earlier day has on a tie', () => {
      const { run, line, tap } = setUp(WHOLE_DAYS);

      // Two evenings and two daytimes: the first day is an evening.
      expect(
        line(
          run(
            ...tap(0, 1, 2, 3),
            { type: 'set_day_window', day: 2, kind: 'daytime' },
            { type: 'set_day_window', day: 3, kind: 'daytime' },
          ),
        )?.time,
      ).toBe('Evenings, but daytime on Wed 14 and Thu 15');
      // And the other way round: the first day is a daytime.
      expect(
        line(
          run(
            ...tap(0, 1, 2, 3),
            { type: 'set_window', kind: 'daytime' },
            { type: 'set_day_window', day: 2, kind: 'evening' },
            { type: 'set_day_window', day: 3, kind: 'evening' },
          ),
        )?.time,
      ).toBe('Daytimes, but evening on Wed 14 and Thu 15');
    });
  });

  it('says one shared time is shared, so Change time is the sheet', () => {
    const { run, line, tap } = setUp(WHOLE_DAYS);

    expect(line(run(...tap(1, 2)))?.shared).toBe(true);
  });
});

describe('across a clock change', () => {
  it('reads the same local hours on days with rows of different lengths as one time (review round 7)', () => {
    // Midnight to 6 am in Melbourne over the clocks going back (Sunday 4 April
    // 2027): the Saturday row has 12 cells and the Sunday row 14.
    const band: PlanTiming = {
      ...WHOLE_DAYS,
      window: { start: localDate('2027-04-03'), end: localDate('2027-04-04') },
      daily: { startMin: 0, endMin: 6 * 60 },
    };
    const rows = dayRows(band, 'en-AU');
    expect(rows.map((row) => row.cells.length)).toEqual([12, 14]);
    const reduce = editorReducer(rows, band);
    const four = (length: number, from: number) =>
      new Array(length).fill(false).map((_, i) => i >= from && i < from + 2);
    const state = [
      { type: 'toggle_day', day: 0 },
      { type: 'toggle_day', day: 1 },
      { type: 'paint', day: 0, cells: four(12, 8) },
      { type: 'paint', day: 1, cells: four(14, 10) },
    ].reduce((s, a) => reduce(s, a as EditorAction), emptyEditor(rows, band));

    const line = answerLineOf(state, rows, band, TWELVE, 'en-AU');
    expect(line?.shared).toBe(true);
    expect(line?.time).toBe('4–5 am, set by the half hour');
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
