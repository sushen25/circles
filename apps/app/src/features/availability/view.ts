import {
  cellsToWindows,
  formatMinutesOfDay,
  headcount,
  rangeText,
  toLocal,
  zone as toZone,
  type DayPart,
  type Interval,
  type OthersSaid,
  type TimeFormat,
} from '@circles/domain';

import type { CellCount, GridDay } from '../../components';
import { t } from '../../copy';
import {
  blockSpan,
  offeredBlocks,
  usualCells,
  windowsFor,
  type BlockKind,
  type BlockTiming,
} from './blocks';
import { dayName, dayNumber, gridSlots, weekdayHeadings, type DayRow, type Mark } from './days';
import { answerLineOf, dayList, tappedNames, type AnswerLine } from './answerLine';
import {
  hasTimes,
  paintedDays,
  tappedDays,
  windowOn,
  wholeDayOn,
  type EditorState,
} from './editor';
import { counted, dayFree, dayLabel, dayOthers, overlapLine } from './others';
import { BLOCK_LABEL } from './words';

/**
 * Everything the editor screen shows, worked out from the answer (spec §5.5,
 * ADR 0024), so that `AvailabilityScreen` stays presentational and what it says
 * can be tested without rendering it.
 */

export type ChoiceView = {
  kind: BlockKind;
  /** "Evening" */
  label: string;
  /** "from 5:30 pm", "12–5 pm"; absent on Any time, which is the whole day. */
  detail?: string | undefined;
  on: boolean;
};

/** "Change time": what the sheet says and offers once any day is tapped. */
export type SheetView = {
  /** "One answer covers Thu 15, Tue 20 and Thu 22." */
  covers: string;
  choices: ChoiceView[];
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
  /** "Overlaps with 3 others", when there are counts to show (SUS-129). */
  others?: string | undefined;
  /** Over the open day's cells: "Others free, by the half hour. The most is 5, …" */
  peak?: string | undefined;
  /** A figure over each of the open day's cells; absent on a day nobody else picked. */
  counts?: CellCount[] | undefined;
};

export type EditorView = {
  grid: GridDay[];
  weekdays: string[];
  /** The one line under the grid; undefined while no day is tapped. */
  answerLine: AnswerLine | undefined;
  /** Every tile carries a number: the others have been read and there are enough to count. */
  counted: boolean;
  sheet: SheetView | undefined;
  /** The exact hours' days: the tapped days, and the open one. */
  answers: AnswerView[];
  /** Days with any time on them. */
  painted: number;
  canUndo: boolean;
  /**
   * Previous times can start this answer (ADR 0005, ADR 0037, ADR 0068): there
   * is something offered before, the answer is still empty and not "I'm easy",
   * and it paints something on this plan. Used to start an answer, never to
   * overwrite one.
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
  /** What the others have said; undefined says nothing about them at all. */
  said?: OthersSaid,
): EditorView {
  const others = counted(said);
  const range = (day: number) =>
    rangeText(cellsToWindows(rows[day]!.date, state.days[day] ?? [], timing), timing.zone, format);
  const slots = gridSlots(rows);

  const grid: GridDay[] = rows.map((row, day) => {
    const times = range(day);
    const selected = times !== undefined;
    const free = others === undefined ? 0 : dayFree(others, row);
    // The number is everyone who could make the day, the reader once they tap
    // it (SUS-206); a day nobody could make shows a muted zero.
    const total = headcount(free, selected);
    const label = selected
      ? t('availability', 'day_with_times', { day: row.spoken, time: times })
      : row.spoken;
    return {
      key: row.date,
      number: dayNumber(row.date, locale),
      name: dayName(row.date, locale),
      label: others === undefined ? label : dayLabel(label, free, selected),
      others: others === undefined ? undefined : String(total),
      othersMuted: others !== undefined && total === 0,
      slot: slots[day]!,
      selected,
      hasTimes: false,
    };
  });

  const tapped = tappedDays(state);
  const sheet: SheetView | undefined =
    tapped.length === 0
      ? undefined
      : {
          covers: t('availability', 'sheet_covers', {
            days: dayList(tappedNames(state, rows, locale), 'and'),
          }),
          choices: offeredBlocks(tapped, rows, timing, windowsFor(timing)).map((offer) => {
            const first = rows[offer.days[0]!]!;
            const spans = offer.days.map((day) => blockSpan(offer.kind, rows[day]!, timing)!);
            // The same time of day on every day it is offered for: the clock on
            // the plan's own zone, not the instant, which differs by date.
            const clock = (span: Interval) => [
              toLocal(span.start, toZone(timing.zone)).minutesOfDay,
              toLocal(span.end, toZone(timing.zone)).minutesOfDay,
            ];
            const same = spans.every((span) => clock(span).join() === clock(spans[0]!).join());
            const hours =
              offer.kind === 'any_time'
                ? undefined
                : !same
                  ? t('availability', 'times_vary')
                  : offer.kind === 'evening' || offer.kind === 'from_now'
                    ? t('availability', 'line_from_time', {
                        time: formatMinutesOfDay(
                          toLocal(spans[0]!.start, toZone(timing.zone)).minutesOfDay,
                          format,
                        ),
                      })
                    : rangeText([blockSpan(offer.kind, first, timing)!], timing.zone, format);
            return {
              kind: offer.kind,
              label: BLOCK_LABEL[offer.kind](),
              detail: hours,
              on: windowOn(offer.kind, state, rows, timing),
            };
          }),
        };

  // The days with times, and the open one even once it has none left, so the
  // row somebody is adjusting does not vanish under their finger.
  const answers: AnswerView[] = rows.flatMap((row, day) => {
    const open = state.open === day;
    if (!open && !hasTimes(state, day)) return [];
    const cells = state.days[day] ?? [];
    const near = others === undefined || !open ? undefined : dayOthers(others, row, timing, format);
    return [
      {
        key: row.date,
        day,
        short: row.short,
        spoken: row.spoken,
        range: range(day) ?? t('availability', 'not_this_day'),
        open,
        cells,
        labels: near?.labels ?? row.cellLabels,
        marks: row.marks,
        wholeDay: wholeDayOn(state, day),
        others: others === undefined ? undefined : overlapLine(others, row, cells),
        peak: near?.sentence,
        counts: near?.counts,
      },
    ];
  });

  const willPaint =
    usual !== undefined &&
    !state.flexible &&
    paintedDays(state) === 0 &&
    usualCells(rows, timing, usual).some((cells) => cells.some(Boolean));

  return {
    grid,
    weekdays: weekdayHeadings(locale),
    answerLine: answerLineOf(state, rows, timing, format, locale),
    counted: others !== undefined,
    sheet,
    answers,
    painted: paintedDays(state),
    canUndo: state.undo !== undefined,
    canUseUsual: willPaint,
  };
}
