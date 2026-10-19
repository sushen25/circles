import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { dayRows } from './days';
import { editorReducer, emptyEditor, type EditorAction } from './editor';
import { sharedTime } from './sharedTime';

/**
 * Whether the tapped days share a time, and what it says (SUS-236, ADR 0079):
 * the line under the pills, and whether the block opens as the list.
 */

const TWELVE = { hour12: true };
const WHOLE: PlanTiming = {
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-27') },
  daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  zone: zone('Australia/Melbourne'),
};

function after(...actions: EditorAction[]) {
  const rows = dayRows(WHOLE, 'en-AU');
  const state = actions.reduce(editorReducer(rows, WHOLE), emptyEditor(rows, WHOLE));
  return sharedTime(state, rows, WHOLE, TWELVE);
}
const tap = (day: number): EditorAction => ({ type: 'toggle_day', day });

describe('sharedTime', () => {
  it('is nothing while no day is tapped', () => {
    expect(after()).toBeUndefined();
  });

  it('says the block the days share, in the words of the line under the pills', () => {
    expect(after(tap(1), tap(3))).toEqual({ same: true, hours: 'From 5:30 pm' });
    expect(after(tap(1), { type: 'set_window', kind: 'daytime' })).toEqual({
      same: true,
      hours: '9 am–5 pm',
    });
    expect(after(tap(1), { type: 'set_window', kind: 'any_time' })).toEqual({
      same: true,
      hours: 'Any time',
    });
  });

  it('says the hours that are no block when every day has the same', () => {
    const cells = new Array(27).fill(false).map((_, i) => i >= 18 && i < 25);
    expect(
      after(tap(1), tap(3), { type: 'paint', day: 1, cells }, { type: 'paint', day: 3, cells }),
    ).toEqual({ same: true, hours: '6–9:30 pm' });
  });

  it('says the days differ when two have different blocks, or a block and their own hours', () => {
    expect(after(tap(1), tap(3), { type: 'set_day_window', day: 3, kind: 'daytime' })).toEqual({
      same: false,
    });
    const cells = new Array(27).fill(false).map((_, i) => i >= 18 && i < 25);
    expect(after(tap(1), tap(3), { type: 'paint', day: 3, cells })).toEqual({ same: false });
  });
});
