import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { offeredBlocks, windowsFor } from './blocks';
import { dayRows, type RowWords } from './days';
import {
  editorFrom,
  editorReducer,
  strokeDays,
  emptyEditor,
  paintedDays,
  tappedDays,
  windowOn,
  windowsOf,
  type EditorAction,
  type EditorState,
} from './editor';

const WORDS: RowWords = {
  cell: (day, from, to) => `${day}, ${from} to ${to}`,
  repeated: (label) => label,
  crossing: (label) => label,
  clocksGoBack: 'Clocks go back',
};

/** Monday 14 to Sunday 20 September, weekday-evening hours every day. */
const EVENINGS: PlanTiming = {
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-20') },
  daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  zone: zone('Australia/Melbourne'),
};
/** The weekend-day band: 9 am to 10:30 pm, 27 half hours. */
const WHOLE_DAYS: PlanTiming = { ...EVENINGS, daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } };

const TUE = 1;
const THU = 3;
const SAT = 5;

function setUp(timing: PlanTiming) {
  const rows = dayRows(timing, { hour12: true }, WORDS, 'en-AU');
  const reduce = editorReducer(rows, timing);
  const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(reduce, state);
  return { rows, reduce, run, start: emptyEditor(rows, timing) };
}

/** 9 am to 5 pm of a 9 am band: the first sixteen half hours. */
const daytimeCells = Array.from({ length: 16 }, (_, i) => i);
const on = (cells: readonly boolean[]) => cells.flatMap((c, i) => (c ? [i] : []));

describe('the answer as cells', () => {
  it('sends painted cells as merged windows, and reopens them exactly as painted', () => {
    const { rows, reduce, start } = setUp(EVENINGS);
    const cells = [false, false, true, true, true, true, false, false, true, true];

    const painted = reduce(start, { type: 'paint', day: 0, cells });
    const windows = windowsOf(painted, rows, EVENINGS);

    // Two runs, two windows: 6:30–8:30 pm and 9:30–10:30 pm, Melbourne (UTC+10).
    expect(windows).toEqual([
      { start: '2026-09-14T08:30:00.000Z', end: '2026-09-14T10:30:00.000Z' },
      { start: '2026-09-14T11:30:00.000Z', end: '2026-09-14T12:30:00.000Z' },
    ]);
    expect(editorFrom(rows, EVENINGS, windows, false).days[0]).toEqual(cells);
    expect(paintedDays(painted)).toBe(1);
  });
});

describe('days first, then a time once (ADR 0068)', () => {
  it('answers "Tue, Thu and Sat evenings" with three taps, the same windows the painter sent', () => {
    const { rows, run, reduce, start } = setUp(EVENINGS);

    const picked = run(
      start,
      { type: 'toggle_day', day: TUE },
      { type: 'toggle_day', day: THU },
      { type: 'toggle_day', day: SAT },
    );

    // What S1-25's painter sent for the same three evenings, cell by cell.
    const painter = [TUE, THU, SAT].reduce(
      (state, day) => reduce(state, { type: 'paint', day, cells: new Array(10).fill(true) }),
      start,
    );
    expect(windowsOf(picked, rows, EVENINGS)).toEqual(windowsOf(painter, rows, EVENINGS));
    expect(windowsOf(picked, rows, EVENINGS)).toEqual([
      { start: '2026-09-15T07:30:00.000Z', end: '2026-09-15T12:30:00.000Z' },
      { start: '2026-09-17T07:30:00.000Z', end: '2026-09-17T12:30:00.000Z' },
      { start: '2026-09-19T07:30:00.000Z', end: '2026-09-19T12:30:00.000Z' },
    ]);
    expect(tappedDays(picked)).toEqual([TUE, THU, SAT]);
  });

  it('gives a tapped day the evening and starts on Evening', () => {
    const { run, start } = setUp(WHOLE_DAYS);

    expect(start.window).toBe('evening');
    const tapped = run(start, { type: 'toggle_day', day: SAT });
    // 5:30 pm to 10:30 pm of a 9 am band: the last ten half hours.
    expect(on(tapped.days[SAT]!)).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  });

  it('untaps a day by clearing it, and closes it if it was open', () => {
    const { run, start } = setUp(EVENINGS);

    const tapped = run(start, { type: 'toggle_day', day: TUE }, { type: 'open', day: TUE });
    const untapped = run(tapped, { type: 'toggle_day', day: TUE });
    expect(paintedDays(untapped)).toBe(0);
    expect(untapped.open).toBeUndefined();
  });

  it('offers only Evening on an evening plan, because Any time is the same hours', () => {
    const { rows } = setUp(EVENINGS);

    expect(
      offeredBlocks([TUE, THU], rows, EVENINGS, windowsFor(EVENINGS)).map((o) => o.kind),
    ).toEqual(['evening']);
    expect(offeredBlocks([], rows, EVENINGS, windowsFor(EVENINGS))).toEqual([]);
  });

  it('offers Evening, Daytime and Any time on a whole-day plan, and never Morning or Afternoon', () => {
    const { rows } = setUp(WHOLE_DAYS);

    expect(
      offeredBlocks([SAT], rows, WHOLE_DAYS, windowsFor(WHOLE_DAYS)).map((o) => o.kind),
    ).toEqual(['evening', 'daytime', 'any_time']);
  });

  it('offers Daytime alone on a morning plan, where Any time is the same hours and there is no evening', () => {
    const morning: PlanTiming = { ...EVENINGS, daily: { startMin: 9 * 60, endMin: 12 * 60 } };
    const { rows, start } = setUp(morning);

    expect(offeredBlocks([TUE], rows, morning, windowsFor(morning)).map((o) => o.kind)).toEqual([
      'daytime',
    ]);
    expect(start.window).toBe('daytime');
  });

  it('gives every tapped day the chosen time, whatever each had, and keeps untapped days empty', () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);

    const evenings = run(
      start,
      { type: 'toggle_day', day: TUE },
      { type: 'toggle_day', day: SAT },
      // Saturday was adjusted by the half hour.
      {
        type: 'paint',
        day: SAT,
        cells: [...new Array(4).fill(true), ...new Array(23).fill(false)],
      },
    );
    expect(windowOn('evening', evenings, rows, WHOLE_DAYS)).toBe(false);

    const afternoons = run(evenings, { type: 'set_window', kind: 'daytime' });
    // 12 to 5 pm: half hours 6 to 15 of a 9 am band.
    expect(on(afternoons.days[TUE]!)).toEqual(daytimeCells);
    expect(afternoons.days[SAT]).toEqual(afternoons.days[TUE]);
    expect(on(afternoons.days[THU]!)).toEqual([]);
    expect(windowOn('daytime', afternoons, rows, WHOLE_DAYS)).toBe(true);
    expect(windowOn('evening', afternoons, rows, WHOLE_DAYS)).toBe(false);
    expect(afternoons.window).toBe('daytime');
  });

  it('gives the next tapped day the time of day last chosen', () => {
    const { run, start } = setUp(WHOLE_DAYS);

    const later = run(
      start,
      { type: 'toggle_day', day: TUE },
      { type: 'set_window', kind: 'daytime' },
      { type: 'toggle_day', day: THU },
    );
    expect(later.days[THU]).toEqual(later.days[TUE]);
  });

  it('ignores a time of day the plan does not offer, and a choice with nothing tapped', () => {
    const { run, start } = setUp(EVENINGS);

    expect(run(start, { type: 'set_window', kind: 'daytime' })).toBe(start);
    const tapped = run(start, { type: 'toggle_day', day: TUE });
    expect(run(tapped, { type: 'set_window', kind: 'daytime' })).toBe(tapped);
  });

  it('reopens an answer with the new tap taking the time it already has', () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);

    const stored = windowsOf(
      run(start, { type: 'toggle_day', day: TUE }, { type: 'set_window', kind: 'daytime' }),
      rows,
      WHOLE_DAYS,
    );
    const reopened = editorFrom(rows, WHOLE_DAYS, stored, false);
    expect(reopened.window).toBe('daytime');
  });

  it('gives the next tap the time of day previous times painted (review round 2)', () => {
    const { run, start } = setUp(WHOLE_DAYS);

    const afternoons = run(start, { type: 'usual', parts: ['weekday_afternoon'] });
    expect(afternoons.window).toBe('afternoon');
    const plusSaturday = run(afternoons, { type: 'toggle_day', day: SAT });
    expect(plusSaturday.days[SAT]).toEqual(plusSaturday.days[TUE]);
  });

  it('gives the next tap the morning that previous times painted, though Morning is not a choice (review round 3)', () => {
    const { run, start } = setUp(WHOLE_DAYS);

    const mornings = run(start, { type: 'usual', parts: ['weekday_morning'] });
    expect(mornings.window).toBe('morning');
    const plusSaturday = run(mornings, { type: 'toggle_day', day: SAT });
    expect(on(plusSaturday.days[SAT]!)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('writes no draft for a window chosen with no day tapped: the answer stays the same array', () => {
    const { run, start } = setUp(EVENINGS);

    expect(run(start, { type: 'open', day: TUE }).days).toBe(start.days);
    expect(run(start, { type: 'close' }).days).toBe(start.days);
  });
});

describe('adjusting one day', () => {
  it('opens one day at a time, and closes it again', () => {
    const { run, start } = setUp(EVENINGS);

    const open = run(start, { type: 'open', day: TUE }, { type: 'open', day: THU });
    expect(open.open).toBe(THU);
    expect(run(open, { type: 'open', day: THU }).open).toBeUndefined();
    expect(run(open, { type: 'close' }).open).toBeUndefined();
  });
});

describe('a time for each day (ADR 0068)', () => {
  it('sets one day to a time of day and leaves the others as they are', () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);

    const tapped = run(start, { type: 'toggle_day', day: THU }, { type: 'toggle_day', day: TUE });
    const mixed = run(tapped, { type: 'set_day_window', day: TUE, kind: 'daytime' });

    expect(on(mixed.days[TUE]!)).toEqual(daytimeCells);
    expect(mixed.days[THU]).toEqual(tapped.days[THU]);
    // The time a new tap gets is the shared one, not this day's.
    expect(mixed.window).toBe('evening');
    expect(windowOn('daytime', mixed, rows, WHOLE_DAYS)).toBe(false);
  });

  it('sends Thursday evening and Tuesday daytime as the windows painting those cells by hand does', () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);

    const quick = run(
      start,
      { type: 'toggle_day', day: THU },
      { type: 'toggle_day', day: TUE },
      { type: 'set_day_window', day: TUE, kind: 'daytime' },
    );
    // By hand: 5:30 to 10:30 pm is the last ten of 27 half hours from 9 am;
    // 9 am to 5 pm is the first sixteen.
    const cells = (from: number, length = 10) =>
      new Array(27).fill(false).map((_, i) => i >= from && i < from + length);
    const byHand = run(
      start,
      { type: 'paint', day: THU, cells: cells(17) },
      { type: 'paint', day: TUE, cells: cells(0, 16) },
    );

    expect(windowsOf(quick, rows, WHOLE_DAYS)).toEqual(windowsOf(byHand, rows, WHOLE_DAYS));
    expect(windowsOf(quick, rows, WHOLE_DAYS)).toEqual([
      { start: '2026-09-14T23:00:00.000Z', end: '2026-09-15T07:00:00.000Z' },
      { start: '2026-09-17T07:30:00.000Z', end: '2026-09-17T12:30:00.000Z' },
    ]);
  });

  it('untaps a day painted empty, and it is no longer the open one (review round 5)', () => {
    const { run, start } = setUp(EVENINGS);

    const open = run(start, { type: 'toggle_day', day: THU }, { type: 'open', day: THU });
    const emptied = run(open, { type: 'paint', day: THU, cells: new Array(10).fill(false) });
    expect(paintedDays(emptied)).toBe(0);
    expect(emptied.open).toBeUndefined();
    // Tapped again later, it is not already expanded.
    expect(run(emptied, { type: 'toggle_day', day: THU }).open).toBeUndefined();
  });

  it('ignores a day that is not tapped, and a time of day the day does not have', () => {
    const { run, start } = setUp(EVENINGS);

    expect(run(start, { type: 'set_day_window', day: TUE, kind: 'evening' })).toBe(start);
    const tapped = run(start, { type: 'toggle_day', day: TUE });
    expect(run(tapped, { type: 'set_day_window', day: TUE, kind: 'daytime' })).toBe(tapped);
  });

  it("takes the days back to one time: the sheet's last choice, or the plan's default", () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);
    const mixed = run(
      start,
      { type: 'toggle_day', day: TUE },
      { type: 'toggle_day', day: THU },
      { type: 'set_day_window', day: TUE, kind: 'daytime' },
    );

    const one = run(mixed, { type: 'use_one_time' });
    expect(one.days[TUE]).toEqual(one.days[THU]);
    expect(windowOn('evening', one, rows, WHOLE_DAYS)).toBe(true);

    // After the sheet chose Afternoon, that is the one time.
    const afternoons = run(
      start,
      { type: 'toggle_day', day: TUE },
      { type: 'toggle_day', day: THU },
      { type: 'set_window', kind: 'daytime' },
      { type: 'set_day_window', day: THU, kind: 'any_time' },
      { type: 'use_one_time' },
    );
    expect(afternoons.days[THU]).toEqual(afternoons.days[TUE]);
    expect(on(afternoons.days[THU]!)).toEqual(daytimeCells);
  });

  it("falls back to the plan's default when the last time of day is one the sheet does not offer", () => {
    const { run, start } = setUp(WHOLE_DAYS);
    const mornings = run(start, { type: 'usual', parts: ['weekday_morning'] });
    expect(mornings.window).toBe('morning');

    const one = run(
      mornings,
      { type: 'set_day_window', day: TUE, kind: 'daytime' },
      { type: 'use_one_time' },
    );
    expect(one.window).toBe('evening');
    expect(one.days[TUE]).toEqual(one.days[THU]);
  });
});

describe('dragging across days (SUS-133, SUS-206)', () => {
  const stroke = (
    base: EditorState,
    rows: ReturnType<typeof setUp>['rows'],
    timing: PlanTiming,
    anchor: number,
    current: number,
  ) => strokeDays(base.days, rows, timing, base.window, anchor, current);

  it('taps every day it crosses when it starts on an untapped day, giving each the current time', () => {
    const { rows, run, start } = setUp(EVENINGS);

    const days = stroke(start, rows, EVENINGS, TUE, SAT);
    const dragged = run(start, { type: 'stroke', days });
    expect(tappedDays(dragged)).toEqual([TUE, 2, THU, 4, SAT]);
    // The same cells as tapping each in turn.
    const tapped = run(
      start,
      ...[TUE, 2, THU, 4, SAT].map((day) => ({ type: 'toggle_day', day }) as const),
    );
    expect(dragged.days).toEqual(tapped.days);
  });

  it('untaps every day it crosses when it starts on a tapped day', () => {
    const { rows, run, start } = setUp(EVENINGS);
    const all = run(start, ...[0, 1, 2, 3, 4].map((day) => ({ type: 'toggle_day', day }) as const));

    const dragged = run(all, { type: 'stroke', days: stroke(all, rows, EVENINGS, 1, 3) });
    expect(tappedDays(dragged)).toEqual([0, 4]);
  });

  it('works backwards, and dragging back gives a day it crossed and left back as it was', () => {
    const { rows, start } = setUp(EVENINGS);

    expect(tappedDays({ days: stroke(start, rows, EVENINGS, 4, 2) })).toEqual([2, 3, 4]);
    // Out to the sixth day and back to the fourth: the stroke is applied to
    // the answer as it was, so the days past the finger are not left tapped.
    expect(tappedDays({ days: stroke(start, rows, EVENINGS, 2, 5) })).toEqual([2, 3, 4, 5]);
    expect(tappedDays({ days: stroke(start, rows, EVENINGS, 2, 3) })).toEqual([2, 3]);
  });

  it('leaves a day that already has its own times as it is, and the days outside the stroke', () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);
    const own = [...new Array(4).fill(true), ...new Array(23).fill(false)];
    const base = run(start, { type: 'toggle_day', day: 0 }, { type: 'paint', day: 3, cells: own });

    const days = strokeDays(base.days, rows, WHOLE_DAYS, base.window, 1, 4);
    expect(days[3]).toEqual(own);
    expect(days[0]).toEqual(base.days[0]);
    expect(days[5]!.some(Boolean)).toBe(false);
    expect(tappedDays({ days })).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("I'm easy", () => {
  it('keeps what was there, so turning it off gives it back', () => {
    const { reduce, start } = setUp(EVENINGS);
    const painted = reduce(start, { type: 'toggle_day', day: 0 });

    const easy = reduce(painted, { type: 'flexible', on: true });
    expect(easy.flexible).toBe(true);
    expect(reduce(easy, { type: 'flexible', on: false }).days).toEqual(painted.days);
  });
});
