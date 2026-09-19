import {
  applyShortcut,
  availableShortcuts,
  cellsToWindows,
  fromISO,
  merge,
  toISO,
  windowsToCells,
  type Interval,
  type PlanTiming,
  type ShortcutKind,
} from '@circles/domain';

import type { Span } from '../../data/availability';
import type { DayRow } from './days';

/**
 * What somebody has painted, as a reducer (spec §5.5).
 *
 * The cells are the state and the windows are derived from them, never the
 * other way round while painting: `cellsToWindows` merges adjacent cells, so a
 * painted evening leaves as one window and the round trip back through
 * `windowsToCells` is the identity (property-tested in the domain). Painting
 * is immediate — every action is a synchronous state change and nothing waits
 * on the network (manifesto §5.5).
 *
 * "I'm easy" dims the rows and keeps them: somebody who turns it on and off
 * again gets back what they painted, not an empty grid.
 */

export type EditorState = {
  /** One `boolean[]` per row, as long as that row's cells. */
  days: boolean[][];
  flexible: boolean;
};

export type EditorAction =
  | { type: 'paint'; day: number; cells: boolean[] }
  | { type: 'shortcut'; kind: ShortcutKind }
  | { type: 'whole_day'; day: number }
  | { type: 'flexible'; on: boolean }
  | { type: 'load'; state: EditorState };

export function emptyEditor(rows: readonly DayRow[]): EditorState {
  return { days: rows.map((row) => row.cells.map(() => false)), flexible: false };
}

/** Stored windows back onto the grid, for reopening an answer or a draft. */
export function editorFrom(
  rows: readonly DayRow[],
  timing: PlanTiming,
  windows: readonly Span[],
  flexible: boolean,
): EditorState {
  const intervals = windows.map((w) => ({ start: fromISO(w.start), end: fromISO(w.end) }));
  return {
    days: rows.map((row) => windowsToCells(row.date, intervals, timing)),
    flexible,
  };
}

/** The painted cells as windows: aligned, merged, sorted, ready to send. */
export function windowsOf(state: EditorState, rows: readonly DayRow[], timing: PlanTiming): Span[] {
  const all: Interval[] = rows.flatMap((row, index) =>
    cellsToWindows(row.date, state.days[index] ?? [], timing),
  );
  return merge(all).map((w) => ({ start: toISO(w.start), end: toISO(w.end) }));
}

/** "3 of 14 days": the days with anything painted on them. */
export function paintedDays(state: EditorState): number {
  return state.days.filter((cells) => cells.some(Boolean)).length;
}

/**
 * The plan-level shortcuts worth offering, in the spec's order.
 *
 * Each is the domain's `applyShortcut`, already clipped to the plan's band, so
 * two can land on exactly the same hours — on a weekday-evening plan "after
 * work", "all evening" and "any time" are all 5:30–10:30 pm. Offering three
 * chips that do one thing reads as a choice that is not there, so only the
 * first of each distinct span is kept. "Any time that day" is per row, beside
 * each date, and so not here.
 */
export function planShortcuts(rows: readonly DayRow[], timing: PlanTiming): ShortcutKind[] {
  const first = rows[0];
  if (first === undefined) return [];
  const seen = new Set<string>();
  return availableShortcuts(first.date, timing).filter((kind) => {
    if (kind === 'any_time') return false;
    const span = applyShortcut(kind, first.date, timing);
    if (span === undefined) return false;
    const key = `${span.start}:${span.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Which cells of a row a shortcut covers. */
function maskFor(kind: ShortcutKind, row: DayRow, timing: PlanTiming): boolean[] {
  const span = applyShortcut(kind, row.date, timing);
  return span === undefined ? row.cells.map(() => false) : windowsToCells(row.date, [span], timing);
}

/**
 * On when every day already has that span painted. A chip is a checkbox, not a
 * mode: it says whether something is true of the answer, and tapping it makes
 * it true or untrue for every day at once.
 */
export function shortcutOn(
  kind: ShortcutKind,
  state: EditorState,
  rows: readonly DayRow[],
  timing: PlanTiming,
): boolean {
  if (rows.length === 0) return false;
  return rows.every((row, index) => {
    const mask = maskFor(kind, row, timing);
    const cells = state.days[index] ?? [];
    return mask.some(Boolean) && mask.every((wanted, i) => !wanted || cells[i] === true);
  });
}

export function wholeDayOn(state: EditorState, day: number): boolean {
  const cells = state.days[day] ?? [];
  return cells.length > 0 && cells.every(Boolean);
}

export function editorReducer(
  rows: readonly DayRow[],
  timing: PlanTiming,
): (state: EditorState, action: EditorAction) => EditorState {
  return (state, action) => {
    switch (action.type) {
      case 'load':
        return action.state;
      case 'flexible':
        return { ...state, flexible: action.on };
      case 'paint':
        return {
          ...state,
          days: state.days.map((cells, index) => (index === action.day ? action.cells : cells)),
        };
      case 'whole_day': {
        const fill = !wholeDayOn(state, action.day);
        return {
          ...state,
          days: state.days.map((cells, index) =>
            index === action.day ? cells.map(() => fill) : cells,
          ),
        };
      }
      case 'shortcut': {
        const on = shortcutOn(action.kind, state, rows, timing);
        return {
          ...state,
          days: rows.map((row, index) => {
            const mask = maskFor(action.kind, row, timing);
            const cells = state.days[index] ?? row.cells.map(() => false);
            return cells.map((painted, i) => (mask[i] === true ? !on : painted));
          }),
        };
      }
    }
  };
}
