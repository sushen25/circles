import {
  cellsToWindows,
  formatMinutesOfDay,
  rangeText,
  toLocal,
  zone as toZone,
  type TimeFormat,
} from '@circles/domain';

import { t } from '../../copy';
import { blockSpan, dayTag, type BlockKind, type BlockTiming, type DayTag } from './blocks';
import { dayName, type DayRow } from './days';
import { tappedDays, type EditorState } from './editor';

/**
 * The one line that says the answer, under the day grid (SUS-206, ADR 0068):
 * the tapped days, and the time of day they all have. "Thu 15, Tue 20, Thu 22"
 * over "Evenings, from 5:30 pm". The words are the copy file's and the days are
 * the editor's; nothing here decides anything, and it is pure so the cases
 * (one day, three, eight, each time of day, days that differ) can be tested
 * without rendering.
 */
export type AnswerLine = {
  /** "Thu 15, Tue 20, Thu 22", or "Thu 15, Fri 16, Sat 17 and 5 more". */
  days: string;
  /** "Evenings, from 5:30 pm" */
  time: string;
};

/** How many days are named before the rest are counted. */
export const NAMED_DAYS = 3;

/** The days in date order, named, with the rest counted past `NAMED_DAYS`. */
export function dayList(names: readonly string[], style: 'commas' | 'and'): string {
  if (names.length <= NAMED_DAYS) {
    if (style === 'commas' || names.length < 2) return names.join(', ');
    return t('availability', 'days_and', {
      rest: names.slice(0, -1).join(', '),
      last: names[names.length - 1]!,
    });
  }
  const first = names.slice(0, NAMED_DAYS).join(', ');
  return t('availability', 'days_and_more', { first, count: names.length - NAMED_DAYS });
}

/** "Thu 15, Tue 20, Thu 22" for the tapped days. */
export function tappedNames(
  state: Pick<EditorState, 'days'>,
  rows: readonly DayRow[],
  locale?: string,
): string[] {
  return tappedDays(state).map((day) => dayName(rows[day]!.date, locale));
}

const WORD: Partial<Record<DayTag, () => string>> = {
  morning: () => t('availability', 'line_morning'),
  afternoon: () => t('availability', 'line_afternoon'),
  evening: () => t('availability', 'line_evening'),
  from_now: () => t('availability', 'line_from_now'),
  later_tonight: () => t('availability', 'line_later_tonight'),
};

/** "from 5:30 pm": where a block starts, on the plan's clock. */
function startsAt(kind: BlockKind, row: DayRow, timing: BlockTiming, format: TimeFormat): string {
  const span = blockSpan(kind, row, timing)!;
  return formatMinutesOfDay(toLocal(span.start, toZone(timing.zone)).minutesOfDay, format);
}

/** A block's hours, "12–5 pm". */
function hoursOf(kind: BlockKind, row: DayRow, timing: BlockTiming, format: TimeFormat): string {
  return rangeText([blockSpan(kind, row, timing)!], timing.zone, format)!;
}

/**
 * The answer in two lines, or undefined while no day is tapped. When every
 * tapped day has the same block it is named ("Evenings, from 5:30 pm"); one
 * day adjusted by the half hour says its hours; days that differ say so, and
 * the exact hours are one tap away.
 */
export function answerLineOf(
  state: Pick<EditorState, 'days'>,
  rows: readonly DayRow[],
  timing: BlockTiming,
  format: TimeFormat,
  locale?: string,
): AnswerLine | undefined {
  const tapped = tappedDays(state);
  if (tapped.length === 0) return undefined;
  const days = dayList(tappedNames(state, rows, locale), 'commas');

  const tags = tapped.map((day) => dayTag(state.days[day] ?? [], rows[day]!, timing));
  const first = tags[0];
  if (first !== undefined && first !== 'some' && tags.every((tag) => tag === first)) {
    const row = rows[tapped[0]!]!;
    const kind = first;
    if (kind === 'any_time') return { days, time: t('availability', 'line_any_time') };
    const word = WORD[kind]!();
    const time =
      kind === 'evening' || kind === 'from_now' || kind === 'later_tonight'
        ? t('availability', 'line_from', { word, time: startsAt(kind, row, timing, format) })
        : t('availability', 'line_between', { word, time: hoursOf(kind, row, timing, format) });
    return { days, time };
  }

  // One time that is not a block, the same on every tapped day: its hours.
  const bits = (day: number) => (state.days[day] ?? []).map(Number).join('');
  if (tapped.every((day) => bits(day) === bits(tapped[0]!))) {
    const row = rows[tapped[0]!]!;
    const hours = rangeText(
      cellsToWindows(row.date, state.days[tapped[0]!] ?? [], timing),
      timing.zone,
      format,
    );
    if (hours !== undefined)
      return { days, time: t('availability', 'line_exact', { time: hours }) };
  }
  return { days, time: t('availability', 'line_differs') };
}
