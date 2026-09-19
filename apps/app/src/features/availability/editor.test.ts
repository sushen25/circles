import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { offeredBlocks } from './blocks';
import { dayRows, type RowWords } from './days';
import {
  blockOn,
  editorFrom,
  editorReducer,
  emptyEditor,
  paintedDays,
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
  return { rows, reduce, run, start: emptyEditor(rows) };
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

describe('days first, then a time once', () => {
  it('answers "Tue, Thu and Sat evenings" with three ticks and one chip, the same windows the painter sent', () => {
    const { rows, run, reduce, start } = setUp(EVENINGS);

    const picked = run(
      start,
      { type: 'tick', day: TUE },
      { type: 'tick', day: THU },
      { type: 'tick', day: SAT },
      { type: 'block', kind: 'evening' },
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
    // Still ticked: Afternoon plus Evening is two taps, and Done lets go.
    expect(picked.ticked).toEqual([TUE, THU, SAT]);
    expect(run(picked, { type: 'done' }).ticked).toEqual([]);
  });

  it('sets no time by ticking a day, and keeps the answer the same array so no draft is written', () => {
    const { run, start } = setUp(EVENINGS);

    const ticked = run(start, { type: 'tick', day: THU }, { type: 'tick', day: TUE });
    expect(ticked.ticked).toEqual([TUE, THU]);
    expect(paintedDays(ticked)).toBe(0);
    expect(ticked.days).toBe(start.days);
    expect(run(ticked, { type: 'tick', day: TUE }).ticked).toEqual([THU]);
    expect(run(ticked, { type: 'open', day: TUE }).days).toBe(start.days);
  });

  it('offers only Evening on an evening plan, because Any time is the same hours', () => {
    const { rows } = setUp(EVENINGS);

    expect(offeredBlocks([TUE, THU], rows, EVENINGS).map((o) => o.kind)).toEqual(['evening']);
    expect(offeredBlocks([], rows, EVENINGS)).toEqual([]);
  });

  it('offers all four blocks on a whole-day plan', () => {
    const { rows } = setUp(WHOLE_DAYS);

    expect(offeredBlocks([SAT], rows, WHOLE_DAYS).map((o) => o.kind)).toEqual([
      'morning',
      'afternoon',
      'evening',
      'any_time',
    ]);
  });

  it('turns a block on for the ticked days only, and off again, leaving the rest of each day', () => {
    const { rows, run, start } = setUp(WHOLE_DAYS);

    const morning = run(
      start,
      { type: 'tick', day: TUE },
      { type: 'tick', day: SAT },
      { type: 'block', kind: 'morning' },
    );
    expect(blockOn('morning', morning, rows, WHOLE_DAYS)).toBe(true);
    // 9 am to 12 pm is the first six half hours; Thursday was not ticked.
    expect(on(morning.days[TUE]!)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(on(morning.days[SAT]!)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(on(morning.days[THU]!)).toEqual([]);

    const both = run(morning, { type: 'block', kind: 'afternoon' });
    const afternoonOnly = run(both, { type: 'block', kind: 'morning' });
    expect(blockOn('morning', afternoonOnly, rows, WHOLE_DAYS)).toBe(false);
    expect(blockOn('afternoon', afternoonOnly, rows, WHOLE_DAYS)).toBe(true);
    // 12 to 5 pm.
    expect(on(afternoonOnly.days[SAT]!)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('is on only when every ticked day already has the whole block', () => {
    const { rows, run, start } = setUp(EVENINGS);

    const tuesday = run(start, { type: 'tick', day: TUE }, { type: 'block', kind: 'evening' });
    const plusThursday = run(tuesday, { type: 'tick', day: THU });
    expect(blockOn('evening', plusThursday, rows, EVENINGS)).toBe(false);

    // Off, so the tap paints it on both rather than clearing Tuesday.
    const both = run(plusThursday, { type: 'block', kind: 'evening' });
    expect(paintedDays(both)).toBe(2);
  });

  it('clears the ticked days, and only those', () => {
    const { run, start } = setUp(EVENINGS);

    const answered = run(
      start,
      { type: 'tick', day: TUE },
      { type: 'tick', day: THU },
      { type: 'block', kind: 'evening' },
      { type: 'done' },
      { type: 'tick', day: THU },
      { type: 'clear_ticked' },
    );
    expect(on(answered.days[TUE]!)).toHaveLength(10);
    expect(on(answered.days[THU]!)).toEqual([]);
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
      { type: 'tick', day: TUE },
      { type: 'block', kind: 'evening' },
      { type: 'paint', day: SAT, cells },
      { type: 'open', day: SAT },
    );

    const cleared = run(answered, { type: 'start_over' });
    expect(paintedDays(cleared)).toBe(0);
    expect(cleared.ticked).toEqual([]);
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

    // Ticking a day is not a change to the answer.
    expect(run(cleared, { type: 'tick', day: THU }).undo).toBeDefined();
    const changed = run(cleared, { type: 'whole_day', day: THU });
    expect(changed.undo).toBeUndefined();
    expect(run(changed, { type: 'undo' }).days).toEqual(changed.days);
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
