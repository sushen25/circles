import {
  cellsToWindows,
  fromISO,
  merge,
  toISO,
  windowsToCells,
  type DayPart,
  type Interval,
  type PlanTiming,
} from '@circles/domain';

import type { Span } from '../../data/availability';
import { blockMask, offeredBlocks, usualCells, type BlockKind, type BlockTiming } from './blocks';
import type { DayRow } from './days';

/**
 * Somebody's answer while they give it, as a reducer (spec §5.5, ADR 0024).
 *
 * The cells are the answer and the windows are derived from them, never the
 * other way round: `cellsToWindows` merges adjacent cells, so a painted evening
 * leaves as one window and the round trip back through `windowsToCells` is the
 * identity (property-tested in the domain). Every action is a synchronous
 * state change and nothing waits on the network (manifesto §5.5).
 *
 * People pick days first and then a time once for all of them, so the state
 * also holds which days are ticked, which one is open for adjusting, and what
 * "Start over" cleared. Those three are **view state**: the draft on the device
 * and the request to the server are built from `days` and `flexible` alone
 * (`useSendAnswer`), so a selection never reaches storage or the network.
 *
 * "I'm easy" dims the editor and keeps what was there: somebody who turns it
 * on and off again gets back what they had, not an empty grid.
 */

export type EditorState = {
  /** One `boolean[]` per row, as long as that row's cells. */
  days: boolean[][];
  flexible: boolean;
  /** Ticked days, as row indices in date order. View state. */
  ticked: readonly number[];
  /** The one day open for adjusting by the half hour. View state. */
  open: number | undefined;
  /** What "Start over" cleared, until the next change to the answer. View state. */
  undo: boolean[][] | undefined;
};

export type EditorAction =
  /** The adjust row: one day's cells, as the track painted them. */
  | { type: 'paint'; day: number; cells: boolean[] }
  /** "Any time that day" / "Clear this day" on the open day. */
  | { type: 'whole_day'; day: number }
  | { type: 'tick'; day: number }
  | { type: 'done' }
  /** A block chip: on or off for every ticked day it exists on. */
  | { type: 'block'; kind: BlockKind }
  | { type: 'clear_ticked' }
  | { type: 'remove_day'; day: number }
  /** Opens a day for adjusting, or closes it if it is the one open. */
  | { type: 'open'; day: number }
  | { type: 'start_over' }
  | { type: 'undo' }
  | { type: 'flexible'; on: boolean }
  /**
   * "Use my usual times": paints the person's usual dayparts onto the plan
   * (ADR 0005). Added to what is there, never sent — it is a start the person
   * then changes, and Send is still theirs to press.
   */
  | { type: 'usual'; parts: readonly DayPart[] }
  | { type: 'load'; state: EditorState };

function withDays(days: boolean[][], flexible = false): EditorState {
  return { days, flexible, ticked: [], open: undefined, undo: undefined };
}

export function emptyEditor(rows: readonly DayRow[]): EditorState {
  return withDays(rows.map((row) => row.cells.map(() => false)));
}

/** Stored windows back onto the grid, for reopening an answer or a draft. */
export function editorFrom(
  rows: readonly DayRow[],
  timing: PlanTiming,
  windows: readonly Span[],
  flexible: boolean,
): EditorState {
  const intervals = windows.map((w) => ({ start: fromISO(w.start), end: fromISO(w.end) }));
  return withDays(
    rows.map((row) => windowsToCells(row.date, intervals, timing)),
    flexible,
  );
}

/** The cells as windows: aligned, merged, sorted, ready to send. */
export function windowsOf(
  state: Pick<EditorState, 'days'>,
  rows: readonly DayRow[],
  timing: PlanTiming,
): Span[] {
  const all: Interval[] = rows.flatMap((row, index) =>
    cellsToWindows(row.date, state.days[index] ?? [], timing),
  );
  return merge(all).map((w) => ({ start: toISO(w.start), end: toISO(w.end) }));
}

/** "3 of 14 days": the days with any time on them. */
export function paintedDays(state: EditorState): number {
  return state.days.filter((cells) => cells.some(Boolean)).length;
}

export function hasTimes(state: EditorState, day: number): boolean {
  return (state.days[day] ?? []).some(Boolean);
}

/**
 * On when every ticked day the block exists on already has all of it. A chip
 * is a checkbox, not a mode (S1-25): it says whether something is true of the
 * answer for these days, and tapping it makes it true or untrue for all of
 * them at once.
 */
export function blockOn(
  kind: BlockKind,
  state: EditorState,
  rows: readonly DayRow[],
  timing: BlockTiming,
): boolean {
  let applies = false;
  for (const day of state.ticked) {
    const row = rows[day];
    const mask = row === undefined ? undefined : blockMask(kind, row, timing);
    if (mask === undefined) continue;
    applies = true;
    const cells = state.days[day] ?? [];
    if (!mask.every((wanted, i) => !wanted || cells[i] === true)) return false;
  }
  return applies;
}

export function wholeDayOn(state: EditorState, day: number): boolean {
  const cells = state.days[day] ?? [];
  return cells.length > 0 && cells.every(Boolean);
}

/** A change to the answer itself, which is what ends the chance to undo. */
function answer(state: EditorState, days: boolean[][]): EditorState {
  return { ...state, days, undo: undefined };
}

function mapDays(
  state: EditorState,
  which: (day: number) => boolean,
  change: (cells: boolean[], day: number) => boolean[],
): boolean[][] {
  return state.days.map((cells, day) => (which(day) ? change(cells, day) : cells));
}

export function editorReducer(
  rows: readonly DayRow[],
  timing: BlockTiming,
): (state: EditorState, action: EditorAction) => EditorState {
  return (state, action) => {
    switch (action.type) {
      case 'load':
        return action.state;
      case 'usual': {
        const usual = usualCells(rows, timing, action.parts);
        return answer(
          state,
          state.days.map((cells, day) => cells.map((on, i) => on || usual[day]?.[i] === true)),
        );
      }
      case 'flexible':
        // A change of answer, from times to "I'm easy" or back: Start over's
        // Undo ends here as it does for any other (review round 2).
        return { ...state, flexible: action.on, undo: undefined };
      case 'paint':
        return answer(
          state,
          mapDays(
            state,
            (day) => day === action.day,
            () => action.cells,
          ),
        );
      case 'whole_day': {
        const fill = !wholeDayOn(state, action.day);
        return answer(
          state,
          mapDays(
            state,
            (day) => day === action.day,
            (cells) => cells.map(() => fill),
          ),
        );
      }
      case 'tick': {
        const ticked = state.ticked.includes(action.day)
          ? state.ticked.filter((day) => day !== action.day)
          : [...state.ticked, action.day].sort((a, b) => a - b);
        return { ...state, ticked };
      }
      case 'done':
        return { ...state, ticked: [] };
      case 'block': {
        const offer = offeredBlocks(state.ticked, rows, timing).find((o) => o.kind === action.kind);
        if (offer === undefined) return state;
        const on = blockOn(action.kind, state, rows, timing);
        return answer(
          state,
          mapDays(
            state,
            (day) => offer.days.includes(day),
            (cells, day) => {
              const mask = blockMask(action.kind, rows[day]!, timing)!;
              return cells.map((painted, i) => (mask[i] === true ? !on : painted));
            },
          ),
        );
      }
      case 'clear_ticked':
        return answer(
          state,
          mapDays(
            state,
            (day) => state.ticked.includes(day),
            (cells) => cells.map(() => false),
          ),
        );
      case 'remove_day':
        return {
          ...answer(
            state,
            mapDays(
              state,
              (day) => day === action.day,
              (cells) => cells.map(() => false),
            ),
          ),
          open: state.open === action.day ? undefined : state.open,
        };
      case 'open':
        return { ...state, open: state.open === action.day ? undefined : action.day };
      case 'start_over':
        if (state.days.every((cells) => !cells.some(Boolean))) return state;
        return {
          ...state,
          days: state.days.map((cells) => cells.map(() => false)),
          ticked: [],
          open: undefined,
          undo: state.days,
        };
      case 'undo':
        return state.undo === undefined ? state : { ...state, days: state.undo, undo: undefined };
    }
  };
}
