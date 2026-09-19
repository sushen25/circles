import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { dayRows, type RowWords } from './days';
import {
  editorFrom,
  editorReducer,
  emptyEditor,
  paintedDays,
  planShortcuts,
  shortcutOn,
  windowsOf,
} from './editor';

const WORDS: RowWords = {
  cell: (day, from, to) => `${day}, ${from} to ${to}`,
  repeated: (label) => label,
  crossing: (label) => label,
  clocksGoBack: 'Clocks go back',
};

const EVENINGS: PlanTiming = {
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-20') },
  daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  zone: zone('Australia/Melbourne'),
};
const WEEKEND: PlanTiming = { ...EVENINGS, daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } };

function setUp(timing: PlanTiming) {
  const rows = dayRows(timing, { hour12: true }, WORDS, 'en-AU');
  return { rows, reduce: editorReducer(rows, timing), start: emptyEditor(rows) };
}

describe('the painter', () => {
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

  it('offers one chip on an evening plan, because after work, all evening and any time are the same hours', () => {
    const { rows } = setUp(EVENINGS);

    expect(planShortcuts(rows, EVENINGS)).toEqual(['after_work']);
  });

  it('offers after work, morning and afternoon on a weekend-day plan', () => {
    const { rows } = setUp(WEEKEND);

    expect(planShortcuts(rows, WEEKEND)).toEqual(['after_work', 'morning', 'afternoon']);
  });

  it('turns a shortcut on for every day, and off again, leaving what else was painted', () => {
    const { rows, reduce, start } = setUp(WEEKEND);
    const morningOnly = reduce(start, { type: 'shortcut', kind: 'morning' });

    expect(shortcutOn('morning', morningOnly, rows, WEEKEND)).toBe(true);
    expect(paintedDays(morningOnly)).toBe(rows.length);

    const both = reduce(morningOnly, { type: 'shortcut', kind: 'afternoon' });
    const afternoonOnly = reduce(both, { type: 'shortcut', kind: 'morning' });

    expect(shortcutOn('morning', afternoonOnly, rows, WEEKEND)).toBe(false);
    expect(shortcutOn('afternoon', afternoonOnly, rows, WEEKEND)).toBe(true);
  });

  it('fills a whole day in one tap, and clears it with the next', () => {
    const { reduce, start } = setUp(EVENINGS);

    const filled = reduce(start, { type: 'whole_day', day: 2 });
    expect(filled.days[2]!.every(Boolean)).toBe(true);
    expect(reduce(filled, { type: 'whole_day', day: 2 }).days[2]!.some(Boolean)).toBe(false);
  });

  it("keeps what was painted under I'm easy, so turning it off gives it back", () => {
    const { reduce, start } = setUp(EVENINGS);
    const painted = reduce(start, { type: 'whole_day', day: 0 });

    const easy = reduce(painted, { type: 'flexible', on: true });
    expect(easy.flexible).toBe(true);
    expect(reduce(easy, { type: 'flexible', on: false }).days).toEqual(painted.days);
  });
});
