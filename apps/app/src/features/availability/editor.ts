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
import {
  blockMask,
  defaultWindow,
  offeredBlocks,
  usualCells,
  windowsFor,
  type BlockKind,
  type BlockTiming,
} from './blocks';
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
 * People pick days first and then a time once for all of them (ADR 0068, which
 * amends ADR 0024): tapping a day gives it the current time of day, so a tapped
 * day is a day with times, and "Change time" gives every tapped day another
 * one. The state also holds that time of day (`window`), which day is open for
 * adjusting by the half hour, and what "Start over" cleared. Those three are
 * **view state**: the draft on the device and the request to the server are
 * built from `days` and `flexible` alone (`useSendAnswer`), so a choice of
 * window never reaches storage or the network.
 *
 * "I'm easy" dims the editor and keeps what was there: somebody who turns it
 * on and off again gets back what they had, not an empty grid.
 */

export type EditorState = {
  /** One `boolean[]` per row, as long as that row's cells. */
  days: boolean[][];
  flexible: boolean;
  /**
   * The time of day a newly tapped day gets, and the one "Change time" last
   * applied. View state.
   */
  window: BlockKind;
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
  /** A tap on a day: it gets the current time of day, or loses its times. */
  | { type: 'toggle_day'; day: number }
  /** "Change time": this time of day on every tapped day, whatever they had. */
  | { type: 'set_window'; kind: BlockKind }
  | { type: 'remove_day'; day: number }
  /** Opens a day for adjusting, or closes it if it is the one open. */
  | { type: 'open'; day: number }
  /** Closes whichever day is open, on the way out of the half hours. */
  | { type: 'close' }
  | { type: 'start_over' }
  | { type: 'undo' }
  | { type: 'flexible'; on: boolean }
  /**
   * Previous times: paints the day-parts the person has offered before onto the plan
   * (ADR 0005). Added to what is there, never sent — it is a start the person
   * then changes, and Send is still theirs to press.
   */
  | { type: 'usual'; parts: readonly DayPart[] }
  | { type: 'load'; state: EditorState };

function withDays(days: boolean[][], window: BlockKind, flexible = false): EditorState {
  return { days, flexible, window, open: undefined, undo: undefined };
}

export function emptyEditor(rows: readonly DayRow[], timing: BlockTiming): EditorState {
  return withDays(
    rows.map((row) => row.cells.map(() => false)),
    defaultWindow(rows, timing),
  );
}

/** The cells of `kind` on a day, or the cells of any time that day where it has none. */
function windowCells(kind: BlockKind, row: DayRow, timing: BlockTiming): boolean[] | undefined {
  return blockMask(kind, row, timing);
}

/**
 * The time of day a new tap should get: the one the first answered day already
 * has, so a reopened Afternoon answer grows by afternoons, and the plan's
 * default when the days are not exactly one of the plan's times of day.
 */
function windowOfDays(
  days: readonly (readonly boolean[])[],
  rows: readonly DayRow[],
  timing: BlockTiming,
): BlockKind {
  const first = days.findIndex((cells) => cells.some(Boolean));
  const same =
    first < 0
      ? undefined
      : windowsFor(timing).find((kind) => {
          const mask = windowCells(kind, rows[first]!, timing);
          return mask !== undefined && mask.every((on, i) => on === days[first]![i]);
        });
  return same ?? defaultWindow(rows, timing);
}

/** Stored windows back onto the grid, for reopening an answer or a draft. */
export function editorFrom(
  rows: readonly DayRow[],
  timing: BlockTiming,
  windows: readonly Span[],
  flexible: boolean,
): EditorState {
  const intervals = windows.map((w) => ({ start: fromISO(w.start), end: fromISO(w.end) }));
  const days = rows.map((row) => windowsToCells(row.date, intervals, timing));
  return withDays(days, windowOfDays(days, rows, timing), flexible);
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
 * Whether every tapped day has exactly this time of day: the choice "Change
 * time" shows as picked. Exactly, not "at least": a day adjusted by the half
 * hour is no longer any of the three.
 */
export function windowOn(
  kind: BlockKind,
  state: EditorState,
  rows: readonly DayRow[],
  timing: BlockTiming,
): boolean {
  const tapped = tappedDays(state);
  if (tapped.length === 0) return false;
  return tapped.every((day) => {
    const mask = blockMask(kind, rows[day]!, timing);
    const cells = state.days[day] ?? [];
    return (
      mask !== undefined && mask.length === cells.length && mask.every((on, i) => on === cells[i])
    );
  });
}

/** The days the person has tapped: the days with any time on them. */
export function tappedDays(state: Pick<EditorState, 'days'>): number[] {
  return state.days.flatMap((cells, day) => (cells.some(Boolean) ? [day] : []));
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
        const days = state.days.map((cells, day) =>
          cells.map((on, i) => on || usual[day]?.[i] === true),
        );
        // A tap after previous times gets the time of day they painted.
        return { ...answer(state, days), window: windowOfDays(days, rows, timing) };
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
      case 'toggle_day': {
        const row = rows[action.day];
        if (row === undefined) return state;
        if (hasTimes(state, action.day)) {
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
        }
        const mask = windowCells(state.window, row, timing);
        if (mask === undefined) return state;
        return answer(
          state,
          mapDays(
            state,
            (day) => day === action.day,
            () => mask,
          ),
        );
      }
      case 'set_window': {
        const offer = offeredBlocks(tappedDays(state), rows, timing, windowsFor(timing)).find(
          (o) => o.kind === action.kind,
        );
        if (offer === undefined) return state;
        return {
          ...answer(
            state,
            mapDays(
              state,
              (day) => offer.days.includes(day),
              (_, day) => windowCells(action.kind, rows[day]!, timing)!,
            ),
          ),
          window: action.kind,
        };
      }
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
      case 'close':
        return { ...state, open: undefined };
      case 'open':
        return { ...state, open: state.open === action.day ? undefined : action.day };
      case 'start_over':
        if (state.days.every((cells) => !cells.some(Boolean))) return state;
        return {
          ...state,
          days: state.days.map((cells) => cells.map(() => false)),
          open: undefined,
          undo: state.days,
        };
      case 'undo':
        return state.undo === undefined ? state : { ...state, days: state.undo, undo: undefined };
    }
  };
}
