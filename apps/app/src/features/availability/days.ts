import {
  askedDays,
  cellsFor,
  toParts,
  type Interval,
  type LocalDate,
  type PlanTiming,
} from '@circles/domain';

/**
 * The editor's rows, worked out once from the plan: which days, and which half
 * hours each has (spec §5.5). The half hours are the answer's data model (ADR
 * 0009); the screen sets them as From – to pairs (`hours.ts`).
 *
 * Pure, so that the hard cases can be tested without rendering anything: the
 * day a clock changes, a band that runs to midnight. The grid itself is the
 * domain's (`cellsFor`); this only names the days.
 */

export type DayRow = {
  date: LocalDate;
  /** One real half hour each. Two more or fewer on the days a clock changes. */
  cells: Interval[];
  /** "Mon 14 Sep", beside the row. */
  short: string;
  /** "Monday 14 September", the start of every cell's label. */
  spoken: string;
};

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

/** "Tue 15": a tapped day named in the answer line, and a day in the wrapped grid. */
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

export function dayRows(timing: PlanTiming, locale?: string): DayRow[] {
  const rows: DayRow[] = [];

  // The days the plan asks about, so a plan with gaps has a row for each of
  // those and none between them; `gridSlots` places each by its date, and
  // the gaps show as blanks in the calendar (ADR 0047).
  for (const date of askedDays(timing.window)) {
    const cells = cellsFor(date, timing);
    // A band that does not happen at all on this date (02:00–03:00 the night
    // the clocks go forward) is not a day anybody can be asked about.
    if (cells.length === 0) continue;

    const spoken = dateWords(date, 'long', locale);
    rows.push({
      date,
      cells,
      short: dateWords(date, 'short', locale),
      spoken,
    });
  }
  return rows;
}
