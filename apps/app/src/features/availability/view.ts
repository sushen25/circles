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

import type { GridDay } from '../../components';
import { t } from '../../copy';
import {
  blockSpan,
  offeredBlocks,
  bandName,
  onlyChoice,
  readsFromStart,
  usualCells,
  windowOfCells,
  windowsFor,
  type BandName,
  type BlockKind,
  type BlockTiming,
} from './blocks';
import { dayName, dayNumber, gridSlots, weekdayHeadings, type DayRow } from './days';
import { addRange, edgeOptions, rangesOf, type Range } from './hours';
import { answerLineOf, dayList, tappedNames, type AnswerLine } from './answerLine';
import { paintedDays, tappedDays, windowOn, type EditorState } from './editor';
import { counted, dayFree, dayLabel, othersLine } from './others';
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

/** One of the quick choices on a day's card: the same presets as the sheet. */
export type DayChoiceView = { kind: BlockKind; label: string; on: boolean };

/** A tapped day on "A time for each day" (SUS-206, ADR 0068). */
export type DayCardView = {
  key: string;
  /** The row index, for the callbacks. */
  day: number;
  /** "Thu 15" */
  name: string;
  /** "Thursday 15 September" */
  spoken: string;
  /** What the day covers: "from 5:30 pm", "12–5 pm", or "6–9:30 pm, your own hours". */
  time: string;
  /** The hours match none of the choices, so none is selected. */
  own: boolean;
  /** Only the choices this plan offers, and that exist on this day. */
  choices: DayChoiceView[];
  /** The day's hours are open for setting. */
  open: boolean;
  cells: boolean[];
  /** The day's hours in words. */
  range: string;
  /** The From – to pairs, while the day is open. */
  hours: HoursView | undefined;
};

/** One time a picker can choose: a boundary between half hours, and its words. */
export type TimeOption = { boundary: number; label: string };

/** One From – to pair, with what each button says and what each picker offers. */
export type RangeView = {
  from: number;
  to: number;
  fromLabel: string;
  toLabel: string;
  fromOptions: TimeOption[];
  toOptions: TimeOption[];
};

/**
 * An open day's hours, set as From – to pairs instead of painted (SUS-206): the
 * pairs, the thin bar that shows them against the band (decoration only), its
 * tick labels, and the one line about the others.
 */
export type HoursView = {
  ranges: RangeView[];
  /** The number of half hours in the band: the pairs' boundaries run 0 to this. */
  length: number;
  /** Whether there is room for another pair. */
  canAdd: boolean;
  /** More than one pair, so a pair can be taken away. */
  canRemove: boolean;
  /** Each pair as fractions of the band, for the bar. */
  bar: { start: number; end: number }[];
  /** "9 am", "3 pm", "10:30 pm": the band's start, middle and end. */
  ticks: string[];
  /** "Most others are free 2–4 pm and 6–8 pm"; absent when nobody else is free. */
  others: string | undefined;
};

export type EditorView = {
  grid: GridDay[];
  weekdays: string[];
  /** The one line under the grid; undefined while no day is tapped. */
  answerLine: AnswerLine | undefined;
  /** Every tile carries a number: the others have been read and there are enough to count. */
  counted: boolean;
  /** The plan leaves one window: no sheet, no choices; the words name the band. */
  single: boolean;
  /** Where the plan's band sits: the words for it when `single`. */
  band: BandName;
  /** What every day is when `single`: "from 5:30 pm", "9 am–12 pm". */
  singleTime: string | undefined;
  sheet: SheetView | undefined;
  /** "A time for each day": a card for each tapped day. */
  cards: DayCardView[];
  /**
   * Previous times can start this answer (ADR 0005, ADR 0037, ADR 0068): there
   * is something offered before, the answer is still empty and not "I'm easy",
   * and it paints something on this plan. Used to start an answer, never to
   * overwrite one.
   */
  canUseUsual: boolean;
};

/** "12:00 pm": a time of day with its minutes, so a button never reads "12 pm to 4 pm". */
function exact(minutes: number, format: TimeFormat): string {
  const said = formatMinutesOfDay(minutes, format);
  return format.hour12 && !said.includes(':') ? said.replace(/^(\d+)/, '$1:00') : said;
}

/** An open day's pairs, bar and line: everything its hours editor shows (`hours.ts`). */
function hoursView(
  cells: readonly boolean[],
  row: DayRow,
  others: OthersSaid | undefined,
  timing: BlockTiming,
  format: TimeFormat,
): HoursView {
  const length = row.cells.length;
  const zone = toZone(timing.zone);
  const at = (boundary: number) => {
    const instant = boundary < length ? row.cells[boundary]!.start : row.cells[length - 1]!.end;
    return toLocal(instant, zone).minutesOfDay;
  };
  // What each boundary is called. The night the clocks go back, two of them are
  // the same time on the clock: the second says so, or two buttons would read alike.
  const seen = new Set<number>();
  const words = Array.from({ length: length + 1 }, (_, boundary) => {
    const minutes = at(boundary);
    const again = seen.has(minutes);
    seen.add(minutes);
    const said = exact(minutes, format);
    return again ? t('availability', 'time_again', { time: said }) : said;
  });
  const options = (which: 'from' | 'to', range: Range): TimeOption[] =>
    edgeOptions(which, range, length).map((boundary) => ({ boundary, label: words[boundary]! }));
  const ranges = rangesOf(cells);
  return {
    ranges: ranges.map((range) => ({
      ...range,
      fromLabel: words[range.from]!,
      toLabel: words[range.to]!,
      fromOptions: options('from', range),
      toOptions: options('to', range),
    })),
    length,
    canAdd: addRange(ranges, length).length > ranges.length,
    canRemove: ranges.length > 1,
    bar: ranges.map((range) => ({ start: range.from / length, end: range.to / length })),
    ticks: [0, Math.round(length / 2), length].map((boundary) =>
      formatMinutesOfDay(at(boundary), format),
    ),
    others: others === undefined ? undefined : othersLine(others, row, timing, format),
  };
}

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
  const only = onlyChoice(rows, timing);
  const sheet: SheetView | undefined =
    tapped.length === 0 || only !== undefined
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
                  : readsFromStart(offer.kind)
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

  // A card for each tapped day, with the choices this plan offers (the
  // sheet's rule) that exist on it, and the half hours when it is open.
  const offered = offeredBlocks(tapped, rows, timing, windowsFor(timing));
  const clockOf = (kind: BlockKind, row: DayRow) => {
    const span = blockSpan(kind, row, timing)!;
    return readsFromStart(kind)
      ? t('availability', 'line_from_time', {
          time: formatMinutesOfDay(toLocal(span.start, toZone(timing.zone)).minutesOfDay, format),
        })
      : rangeText([span], timing.zone, format)!;
  };
  const cards: DayCardView[] = tapped.map((day) => {
    const row = rows[day]!;
    const cells = state.days[day] ?? [];
    const open = state.open === day;
    const matched = windowOfCells(cells, row, timing);
    const hours = range(day) ?? '';
    return {
      key: row.date,
      day,
      name: dayName(row.date, locale),
      spoken: row.spoken,
      time:
        matched === undefined
          ? only === undefined
            ? t('availability', 'own_hours', { hours })
            : hours
          : clockOf(matched, row),
      own: matched === undefined,
      choices: (only !== undefined ? [] : offered)
        .filter((offer) => offer.days.includes(day))
        .map((offer) => ({
          kind: offer.kind,
          label: BLOCK_LABEL[offer.kind](),
          on: offer.kind === matched,
        })),
      open,
      cells,
      range: hours,
      hours: open ? hoursView(cells, row, others, timing, format) : undefined,
    };
  });

  const willPaint =
    usual !== undefined &&
    !state.flexible &&
    paintedDays(state) === 0 &&
    usualCells(rows, timing, usual).some((cells) => cells.some(Boolean));

  return {
    grid,
    weekdays: weekdayHeadings(locale),
    answerLine: answerLineOf(
      state,
      rows,
      timing,
      format,
      locale,
      only === undefined ? undefined : bandName(timing),
    ),
    counted: others !== undefined,
    single: only !== undefined,
    band: bandName(timing),
    singleTime: only === undefined || rows[0] === undefined ? undefined : clockOf(only, rows[0]),
    sheet,
    cards,
    canUseUsual: willPaint,
  };
}
