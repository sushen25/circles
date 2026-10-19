import {
  cellsToWindows,
  formatMinutesOfDay,
  headcount,
  rangeText,
  toLocal,
  zone as toZone,
  type DayPart,
  type OthersSaid,
  type TimeFormat,
} from '@circles/domain';

import type { GridDay } from '../../components';
import { t } from '../../copy';
import {
  offeredBlocks,
  bandName,
  onlyChoice,
  usualCells,
  windowOfCells,
  windowsFor,
  type BandName,
  type BlockKind,
  type BlockTiming,
} from './blocks';
import { dayName, dayNumber, gridSlots, weekdayHeadings, type DayRow } from './days';
import { addRange, edgeOptions, rangesOf, type Range } from './hours';
import { sharedTime } from './sharedTime';
import { paintedDays, tappedDays, windowOn, type EditorState } from './editor';
import { counted, dayFree, dayLabel, othersLine } from './others';
import { BLOCK_LABEL } from './words';

/**
 * Everything the editor screen shows, worked out from the answer (spec §5.5,
 * ADR 0024), so that `AvailabilityScreen` stays presentational and what it says
 * can be tested without rendering it.
 */

/** One of the time-of-day pills: the first screen's, and a day's row (ADR 0079). */
export type ChoiceView = {
  kind: BlockKind;
  /** "Evening" */
  label: string;
  on: boolean;
};

/**
 * "When, on those days?" (SUS-236): the answer block under the grid once any
 * day is tapped. The pills are the choices the plan leaves, clipped, deduped and
 * none at all for one window (ADR 0068); the line under them is the chosen
 * one's hours.
 */
export type AnswerBlockView = {
  /** "10 days" */
  count: string;
  /** Empty on a plan with one window: there is nothing to pick. */
  choices: ChoiceView[];
  /** "From 5:30 pm", "9 am–5 pm", "Any time"; the hours when they are no choice. */
  hours: string | undefined;
  /** The days do not share a time, so the block opens as "A time for each day". */
  differ: boolean;
};

/** A tapped day on "A time for each day" (SUS-236, ADR 0079). */
export type DayRowView = {
  key: string;
  /** The row index, for the callbacks. */
  day: number;
  /** "Thu 15" */
  name: string;
  /** "Thursday 15 September" */
  spoken: string;
  /** The hours match none of the choices: none is selected and the clock is lit. */
  own: boolean;
  /** The time of day the day is exactly, whether or not the plan offers a choice of it. */
  window: BlockKind | undefined;
  /** Only the choices this plan offers, and that exist on this day; none for one window. */
  choices: ChoiceView[];
  /** The day's hours in words, "6–9:30 pm". */
  range: string;
  /** The From – to pairs, while the day's sheet is open. */
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
  /** The answer block; undefined while no day is tapped. */
  block: AnswerBlockView | undefined;
  /** Every tile carries a number: the others have been read and there are enough to count. */
  counted: boolean;
  /** The plan leaves one window: no pills; the words name the band. */
  single: boolean;
  /** Where the plan's band sits: the words for it when `single`. */
  band: BandName;
  /** "A time for each day": a row for each tapped day. */
  rows: DayRowView[];
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
  const offered = offeredBlocks(tapped, rows, timing, windowsFor(timing));
  const same = sharedTime(state, rows, timing, format);
  const choices: ChoiceView[] =
    only !== undefined
      ? []
      : offered.map((offer) => ({
          kind: offer.kind,
          label: BLOCK_LABEL[offer.kind](),
          on: windowOn(offer.kind, state, rows, timing),
        }));
  const block: AnswerBlockView | undefined =
    same === undefined
      ? undefined
      : {
          count: t('availability', tapped.length === 1 ? 'days_count_one' : 'days_count_other', {
            count: tapped.length,
          }),
          choices,
          hours: same.same ? same.hours : undefined,
          differ: !same.same,
        };

  // A row for each tapped day, with the choices this plan offers that exist on
  // it, and the half hours when its sheet is open.
  const dayRows: DayRowView[] = tapped.map((day) => {
    const row = rows[day]!;
    const cells = state.days[day] ?? [];
    const matched = windowOfCells(cells, row, timing);
    return {
      key: row.date,
      day,
      name: dayName(row.date, locale),
      spoken: row.spoken,
      own: matched === undefined,
      window: matched,
      choices: (only !== undefined ? [] : offered)
        .filter((offer) => offer.days.includes(day))
        .map((offer) => ({
          kind: offer.kind,
          label: BLOCK_LABEL[offer.kind](),
          on: offer.kind === matched,
        })),
      range: range(day) ?? '',
      hours: state.open === day ? hoursView(cells, row, others, timing, format) : undefined,
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
    block,
    counted: others !== undefined,
    single: only !== undefined,
    band: bandName(timing),
    rows: dayRows,
    canUseUsual: willPaint,
  };
}
