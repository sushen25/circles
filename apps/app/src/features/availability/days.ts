import {
  addDays,
  cellsFor,
  formatMinutesOfDay,
  toLocal,
  toParts,
  type Interval,
  type LocalDate,
  type PlanTiming,
  type TimeFormat,
} from '@circles/domain';

/**
 * The painter's rows, worked out once from the plan: which days, which half
 * hours each has, and the words a screen reader says for each (spec §5.5, §10).
 *
 * Pure, so that the hard cases can be tested without rendering anything: the
 * day a clock changes, a band that runs to midnight, a plan in a zone the
 * device is not in. The grid itself is the domain's (`cellsFor`); this only
 * names what it returns. Sentences come in as `words`, from the copy file.
 */

export type Mark = { at: number; label: string };

export type DayRow = {
  date: LocalDate;
  /** One real half hour each. Two more or fewer on the days a clock changes. */
  cells: Interval[];
  /** "Mon 14 Sep", beside the row. */
  short: string;
  /** "Monday 14 September", the start of every cell's label. */
  spoken: string;
  /** "Monday 14 September, 6:30 to 7 pm", one per cell. */
  cellLabels: string[];
  /** Times under the row, at cell boundaries. */
  marks: Mark[];
};

export type RowWords = {
  /** `{day}, {from} to {to}` */
  cell: (day: string, from: string, to: string) => string;
  /** A half hour that is happening for the second time that night. */
  repeated: (label: string) => string;
  /** The half hour the clocks go back in, which reads "2:30 to 2 am". */
  crossing: (label: string) => string;
  /** The mark where the clocks go back. */
  clocksGoBack: string;
};

/** The device's own clock: 18:30 for most of the world, 6:30 pm for some. */
export function deviceTimeFormat(): TimeFormat {
  try {
    const options = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    if (options.hour12 !== undefined) return { hour12: options.hour12 };
    if (options.hourCycle !== undefined) {
      return { hour12: options.hourCycle === 'h11' || options.hourCycle === 'h12' };
    }
  } catch {
    // A runtime without Intl's resolved options. The canvas's 12-hour clock.
  }
  return { hour12: true };
}

/** A calendar date in words, as the device's locale writes it. Never a zone's. */
export function dateWords(date: LocalDate, style: 'short' | 'long', locale?: string): string {
  const { year, month, day } = toParts(date);
  // Noon UTC, formatted in UTC: a date has no zone, and midnight in one would
  // read as the day before somewhere west of Greenwich.
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: style,
    day: 'numeric',
    month: style,
  })
    .format(at)
    .replace(',', '');
}

/** Noon UTC on the date: a date has no zone, so it is formatted in UTC. */
function noonOf(date: LocalDate): Date {
  const { year, month, day } = toParts(date);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** "14", as the device's locale writes a day of the month. */
export function dayNumber(date: LocalDate, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric' }).format(noonOf(date));
}

/** "Tue 15": a ticked day named in the panel, and a day in the wrapped grid. */
export function dayName(date: LocalDate, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
    .format(noonOf(date))
    .replace(',', '');
}

/** Monday 0 to Sunday 6. */
function weekdayOf(date: LocalDate): number {
  return (noonOf(date).getUTCDay() + 6) % 7;
}

/**
 * Each row's place in a calendar that starts on the Monday of the first row's
 * week: its column is `slot % 7`, its week `slot / 7`. Counted from the dates,
 * so a day with no row (the night the clocks go forward on a band inside the
 * missing hour) leaves a gap rather than moving every later day along.
 */
export function gridSlots(rows: readonly DayRow[]): number[] {
  const first = rows[0];
  if (first === undefined) return [];
  const origin = noonOf(first.date).getTime() - weekdayOf(first.date) * 86_400_000;
  return rows.map((row) => Math.round((noonOf(row.date).getTime() - origin) / 86_400_000));
}

/** The seven column headings, Monday first: "Mon" … "Sun". */
export function weekdayHeadings(locale?: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' });
  // 5 January 2026 was a Monday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2026, 0, 5 + i, 12))));
}

/** Minutes from the local midnight of `date` — so a cell ending at midnight is 1440, not 0. */
function minutesInto(date: LocalDate, instant: Interval['start'], timing: PlanTiming): number {
  const local = toLocal(instant, timing.zone);
  return local.date === date ? local.minutesOfDay : local.minutesOfDay + 24 * 60;
}

/** How many cells a row shows before it scrolls (ADR 0009's viewport). */
export const VISIBLE = 10;

export function dayRows(
  timing: PlanTiming,
  format: TimeFormat,
  words: RowWords,
  locale?: string,
): DayRow[] {
  const rows: DayRow[] = [];

  for (let date = timing.window.start; date <= timing.window.end; date = addDays(date, 1)) {
    const cells = cellsFor(date, timing);
    // A band that does not happen at all on this date (02:00–03:00 the night
    // the clocks go forward) is not a day anybody can be asked about.
    if (cells.length === 0) continue;

    const spoken = dateWords(date, 'long', locale);
    const starts = cells.map((cell) => minutesInto(date, cell.start, timing));
    const ends = cells.map((cell) => minutesInto(date, cell.end, timing));

    // The night the clocks go back, 2:00 and 2:30 happen twice, and both are
    // real time somebody can be free during. The domain gives each its own
    // cell; saying which one is which is this module's job.
    const seen = new Set<number>();
    let backAt: number | undefined;
    const cellLabels = cells.map((_, index) => {
      const from = starts[index]!;
      const to = ends[index]!;
      // "6:30 to 7 pm": the suffix once when both ends share it, as
      // `formatRange` writes a range.
      const sameHalf = from % 1440 < 720 === to % 1440 < 720;
      const label = words.cell(
        spoken,
        formatMinutesOfDay(from % 1440, format, !sameHalf),
        formatMinutesOfDay(to % 1440, format),
      );
      const again = seen.has(from);
      seen.add(from);
      if (again && backAt === undefined) backAt = index;
      if (again) return words.repeated(label);
      // Ends earlier on the clock than it starts, and not at midnight: the
      // clocks went back inside it.
      if (to % 1440 !== 0 && to % 1440 <= from % 1440) return words.crossing(label);
      return label;
    });

    rows.push({
      date,
      cells,
      short: dateWords(date, 'short', locale),
      spoken,
      cellLabels,
      marks: marksFor(starts, ends, format, backAt, words.clocksGoBack),
    });
  }
  return rows;
}

/**
 * Start, middle and end for a row that fits — the canvas's "5:30 pm · 8 pm ·
 * 10:30 pm" — and every two hours for one that scrolls, so a person halfway
 * along a Saturday can still tell where they are.
 */
function marksFor(
  starts: readonly number[],
  ends: readonly number[],
  format: TimeFormat,
  backAt: number | undefined,
  clocksGoBack: string,
): Mark[] {
  const count = starts.length;
  const at = (boundary: number) =>
    boundary === count ? ends[count - 1]! % 1440 : starts[boundary]! % 1440;
  const label = (boundary: number) => formatMinutesOfDay(at(boundary), format);

  const boundaries =
    count <= VISIBLE
      ? [0, Math.round(count / 2), count]
      : Array.from({ length: Math.floor(count / 4) + 1 }, (_, i) => i * 4).concat(
          count % 4 === 0 ? [] : [count],
        );

  const marks = [...new Set(boundaries)]
    .filter((boundary) => boundary !== backAt)
    .map((boundary) => ({ at: boundary, label: label(boundary) }));
  if (backAt !== undefined) marks.push({ at: backAt, label: clocksGoBack });
  return marks.sort((a, b) => a.at - b.at);
}
