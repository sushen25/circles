import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { offeredBlocks, windowsFor } from './blocks';
import { dayRows, type RowWords } from './days';
import {
  editorFrom,
  editorReducer,
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
      (state, day) => reduce(state, { type: 'whole_day', day }),
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

  it('offers Evening, Afternoon and Any time on a whole-day plan, and never Morning', () => {
    const { rows } = setUp(WHOLE_DAYS);

    expect(
      offeredBlocks([SAT], rows, WHOLE_DAYS, windowsFor(WHOLE_DAYS)).map((o) => o.kind),
    ).toEqual(['evening', 'afternoon', 'any_time']);
  });

  it('offers Any time alone on a morning plan, where there is no evening or afternoon', () => {
    const morning: PlanTiming = { ...EVENINGS, daily: { startMin: 9 * 60, endMin: 12 * 60 } };
    const { rows, start } = setUp(morning);

    expect(offeredBlocks([TUE], rows, morning, windowsFor(morning)).map((o) => o.kind)).toEqual([
      'any_time',
    ]);
    expect(start.window).toBe('any_time');
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

    const afternoons = run(evenings, { type: 'set_window', kind: 'afternoon' });
    // 12 to 5 pm: half hours 6 to 15 of a 9 am band.
    expect(on(afternoons.days[TUE]!)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(afternoons.days[SAT]).toEqual(afternoons.days[TUE]);
    expect(on(afternoons.days[THU]!)).toEqual([]);
    expect(windowOn('afternoon', afternoons, rows, WHOLE_DAYS)).toBe(true);
    expect(windowOn('evening', afternoons, rows, WHOLE_DAYS)).toBe(false);
    expect(afternoons.window).toBe('afternoon');
  });

  it('gives the next tapped day the time of day last chosen', () => {
    const { run, start } = setUp(WHOLE_DAYS);

    const later = run(
      start,
      { type: 'toggle_day', day: TUE },
      { type: 'set_window', kind: 'afternoon' },
      { type: 'toggle_day', day: THU },
    );
    expect(later.days[THU]).toEqual(later.days[TUE]);
  });

  it('ignores a time of day the plan does not offer, and a choice with nothing tapped', () => {
    const { run, start } = setUp(EVENINGS);

    expect(run(start, { type: 'set_window', kind: 'afternoon' })).toBe(start);
    const tapped = run(start, { type: 'toggle_day', day: TUE });
    expect(run(tapped, { type: 'set_window', kind: 'afternoon' })).toBe(tapped);
  });

  it('reopens an answer with the new tap taking the time it already has', () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);

    const stored = windowsOf(
      run(start, { type: 'toggle_day', day: TUE }, { type: 'set_window', kind: 'afternoon' }),
      rows,
      WHOLE_DAYS,
    );
    const reopened = editorFrom(rows, WHOLE_DAYS, stored, false);
    expect(reopened.window).toBe('afternoon');
  });

  it('writes no draft for a window chosen with no day tapped: the answer stays the same array', () => {
    const { run, start } = setUp(EVENINGS);

    expect(run(start, { type: 'open', day: TUE }).days).toBe(start.days);
    expect(run(start, { type: 'close' }).days).toBe(start.days);
  });
});

describe('adjusting one day', () => {
  it('opens one day at a time, and removing a day closes it', () => {
    const { run, start } = setUp(EVENINGS);

    const open = run(start, { type: 'open', day: TUE }, { type: 'open', day: THU });
    expect(open.open).toBe(THU);
    expect(run(open, { type: 'open', day: THU }).open).toBeUndefined();

    const removed = run(open, { type: 'whole_day', day: THU }, { type: 'remove_day', day: THU });
    expect(removed.open).toBeUndefined();
    expect(paintedDays(removed)).toBe(0);
  });

  it('fills a whole day in one tap, and clears it with the next', () => {
    const { reduce, start } = setUp(EVENINGS);

    const filled = reduce(start, { type: 'whole_day', day: 2 });
    expect(filled.days[2]!.every(Boolean)).toBe(true);
    expect(reduce(filled, { type: 'whole_day', day: 2 }).days[2]!.some(Boolean)).toBe(false);
  });
});

describe('start over', () => {
  it('clears everything, and Undo gives back exactly the answer that was there', () => {
    const { rows, run, start } = setUp(EVENINGS);
    const cells = [false, true, true, false, false, true, true, true, false, false];
    const answered = run(
      start,
      { type: 'toggle_day', day: TUE },
      { type: 'paint', day: SAT, cells },
      { type: 'open', day: SAT },
    );

    const cleared = run(answered, { type: 'start_over' });
    expect(paintedDays(cleared)).toBe(0);
    expect(cleared.open).toBeUndefined();
    expect(cleared.undo).toBeDefined();

    const back = run(cleared, { type: 'undo' });
    expect(back.days).toEqual(answered.days);
    expect(windowsOf(back, rows, EVENINGS)).toEqual(windowsOf(answered, rows, EVENINGS));
    expect(back.undo).toBeUndefined();
  });

  it('offers Undo only until the next change to the answer', () => {
    const { run, start } = setUp(EVENINGS);
    const cleared = run(start, { type: 'whole_day', day: TUE }, { type: 'start_over' });

    // Opening a day is not a change to the answer.
    expect(run(cleared, { type: 'open', day: THU }).undo).toBeDefined();
    const changed = run(cleared, { type: 'whole_day', day: THU });
    expect(changed.undo).toBeUndefined();
    expect(run(changed, { type: 'undo' }).days).toEqual(changed.days);
  });

  it("ends the chance to undo when the answer becomes I'm easy, even if it is turned off again (round 2)", () => {
    const { run, start } = setUp(EVENINGS);
    const cleared = run(start, { type: 'whole_day', day: TUE }, { type: 'start_over' });

    const easyAndBack = run(
      cleared,
      { type: 'flexible', on: true },
      { type: 'flexible', on: false },
    );
    expect(easyAndBack.undo).toBeUndefined();
    expect(run(easyAndBack, { type: 'undo' }).days).toEqual(cleared.days);
  });

  it('does nothing to an empty answer, so there is nothing to undo', () => {
    const { run, start } = setUp(EVENINGS);

    expect(run(start, { type: 'start_over' }).undo).toBeUndefined();
  });
});

describe("I'm easy", () => {
  it('keeps what was there, so turning it off gives it back', () => {
    const { reduce, start } = setUp(EVENINGS);
    const painted = reduce(start, { type: 'whole_day', day: 0 });

    const easy = reduce(painted, { type: 'flexible', on: true });
    expect(easy.flexible).toBe(true);
    expect(reduce(easy, { type: 'flexible', on: false }).days).toEqual(painted.days);
  });
});
