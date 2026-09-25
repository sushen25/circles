import { cellsToWindows, rangeText, type DayPart, type TimeFormat } from '@circles/domain';

import type { GridDay } from '../../components';
import { t } from '../../copy';
import {
  blockSpan,
  dayTag,
  offeredBlocks,
  usualCells,
  type BlockKind,
  type BlockTiming,
} from './blocks';
import { dayName, dayNumber, gridSlots, weekdayHeadings, type DayRow, type Mark } from './days';
import { blockOn, hasTimes, paintedDays, wholeDayOn, type EditorState } from './editor';
import { BLOCK_LABEL, TAG_WORD } from './words';

/**
 * Everything the editor screen shows, worked out from the answer (spec §5.5,
 * ADR 0024), so that `AvailabilityScreen` stays presentational and what it says
 * can be tested without rendering it.
 */

export type BlockView = {
  kind: BlockKind;
  /** "Evening" */
  label: string;
  /** "5:30–10:30 pm", or "9 am–12 pm · 1 of these 3 days" when it is not on all of them. */
  detail: string;
  on: boolean;
};

/** The card under the grid, once any day is ticked. */
export type PanelView = {
  /** "Tue 15, Thu 17, Sat 19", or "5 days selected". */
  title: string;
  blocks: BlockView[];
  /** Some ticked day has times, so "Clear these days" does something. */
  canClear: boolean;
};

/** One line of "My answer". */
export type AnswerView = {
  key: string;
  /** The row index, for the callbacks. */
  day: number;
  /** "Tue 15 Sep" */
  short: string;
  /** "Tuesday 15 September" */
  spoken: string;
  /** "5:30–10:30 pm", or "Not this day" for an open day with nothing left on it. */
  range: string;
  open: boolean;
  cells: boolean[];
  labels: string[];
  marks: Mark[];
  /** Every cell on: "Any time that day" becomes "Clear this day". */
  wholeDay: boolean;
};

export type EditorView = {
  grid: GridDay[];
  weekdays: string[];
  panel: PanelView | undefined;
  answers: AnswerView[];
  /** Days with any time on them. */
  painted: number;
  canUndo: boolean;
  /**
   * "Use my usual times" is on offer (ADR 0005): there is a usual to use, the
   * answer is still empty and not "I'm easy", and the usual paints something
   * on this plan. Offered to start an answer, never to overwrite one.
   */
  canUseUsual: boolean;
};

export function editorView(
  state: EditorState,
  rows: readonly DayRow[],
  timing: BlockTiming,
  format: TimeFormat,
  locale?: string,
  usual?: readonly DayPart[],
): EditorView {
  const range = (day: number) =>
    rangeText(cellsToWindows(rows[day]!.date, state.days[day] ?? [], timing), timing.zone, format);
  const slots = gridSlots(rows);

  const grid: GridDay[] = rows.map((row, day) => {
    const times = range(day);
    const tag = dayTag(state.days[day] ?? [], row, timing);
    return {
      key: row.date,
      number: dayNumber(row.date, locale),
      name: dayName(row.date, locale),
      tag: tag === undefined ? undefined : TAG_WORD[tag](),
      label:
        times === undefined
          ? t('availability', 'day_no_times', { day: row.spoken })
          : t('availability', 'day_with_times', { day: row.spoken, time: times }),
      slot: slots[day]!,
      selected: state.ticked.includes(day),
      hasTimes: times !== undefined,
    };
  });

  const panel: PanelView | undefined =
    state.ticked.length === 0
      ? undefined
      : {
          title:
            state.ticked.length <= 3
              ? state.ticked.map((day) => dayName(rows[day]!.date, locale)).join(', ')
              : t('availability', 'days_selected', { count: state.ticked.length }),
          blocks: offeredBlocks(state.ticked, rows, timing).map((offer) => {
            const hours = [
              ...new Set(
                offer.days.map((day) =>
                  rangeText([blockSpan(offer.kind, rows[day]!, timing)!], timing.zone, format)!,
                ),
              ),
            ];
            const time = hours.length === 1 ? hours[0]! : t('availability', 'times_vary');
            return {
              kind: offer.kind,
              label: BLOCK_LABEL[offer.kind](),
              detail:
                offer.days.length === state.ticked.length
                  ? time
                  : t('availability', 'block_some_days', {
                      time,
                      count: offer.days.length,
                      total: state.ticked.length,
                    }),
              on: blockOn(offer.kind, state, rows, timing),
            };
          }),
          canClear: state.ticked.some((day) => hasTimes(state, day)),
        };

  // The days with times, and the open one even once it has none left, so the
  // row somebody is adjusting does not vanish under their finger.
  const answers: AnswerView[] = rows.flatMap((row, day) => {
    const open = state.open === day;
    if (!open && !hasTimes(state, day)) return [];
    return [
      {
        key: row.date,
        day,
        short: row.short,
        spoken: row.spoken,
        range: range(day) ?? t('availability', 'not_this_day'),
        open,
        cells: state.days[day] ?? [],
        labels: row.cellLabels,
        marks: row.marks,
        wholeDay: wholeDayOn(state, day),
      },
    ];
  });

  return {
    grid,
    weekdays: weekdayHeadings(locale),
    panel,
    answers,
    painted: paintedDays(state),
    canUndo: state.undo !== undefined,
    canUseUsual:
      usual !== undefined &&
      !state.flexible &&
      paintedDays(state) === 0 &&
      usualCells(rows, timing, usual).some((cells) => cells.some(Boolean)),
  };
}
