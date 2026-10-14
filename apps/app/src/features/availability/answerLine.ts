import {
  cellsToWindows,
  formatMinutesOfDay,
  rangeText,
  toLocal,
  zone as toZone,
  type TimeFormat,
} from '@circles/domain';

import { t } from '../../copy';
import {
  blockSpan,
  dayTag,
  readsFromStart,
  type BandName,
  type BlockKind,
  type BlockTiming,
  type DayTag,
} from './blocks';
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
  /** "Evenings, from 5:30 pm", or, when the days differ, each with its own. */
  time: string;
  /** Every tapped day has the same time: "Change time" is the sheet, else the per-day screen. */
  shared: boolean;
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
  daytime: () => t('availability', 'line_daytime'),
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

/** The lower-case word for what a day has, in the middle of a sentence. */
const IN_SENTENCE: Partial<Record<DayTag, () => string>> = {
  morning: () => t('availability', 'day_morning'),
  afternoon: () => t('availability', 'day_afternoon'),
  daytime: () => t('availability', 'day_daytime'),
  evening: () => t('availability', 'day_evening'),
  any_time: () => t('availability', 'day_any_time'),
  from_now: () => t('availability', 'day_from_now'),
  later_tonight: () => t('availability', 'day_later_tonight'),
};

/** The same, as the plural that starts the line: "Evenings", "Daytimes". */
const LEAD: Partial<Record<DayTag, () => string>> = {
  morning: () => t('availability', 'line_morning'),
  afternoon: () => t('availability', 'line_afternoon'),
  daytime: () => t('availability', 'lead_daytime'),
  evening: () => t('availability', 'line_evening'),
  any_time: () => t('availability', 'lead_any_time'),
  from_now: () => t('availability', 'line_from_now'),
  later_tonight: () => t('availability', 'line_later_tonight'),
};

/** The counted noun for a time of day, where there is one: "4 daytimes". */
const COUNTED: Partial<Record<DayTag, (count: number) => string>> = {
  morning: (count) =>
    t('availability', count === 1 ? 'noun_morning_one' : 'noun_morning_other', { count }),
  afternoon: (count) =>
    t('availability', count === 1 ? 'noun_afternoon_one' : 'noun_afternoon_other', { count }),
  daytime: (count) =>
    t('availability', count === 1 ? 'noun_daytime_one' : 'noun_daytime_other', { count }),
  evening: (count) =>
    t('availability', count === 1 ? 'noun_evening_one' : 'noun_evening_other', { count }),
  any_time: (count) =>
    t('availability', count === 1 ? 'noun_any_time_one' : 'noun_any_time_other', { count }),
};

/**
 * What a tapped day has: its time of day when it is exactly one the plan has,
 * else its hours ("6–9:30 pm"). Days with the same `key` have the same thing.
 */
type Kind = { key: string; tag: DayTag | undefined; hours: string };

function kindOf(
  cells: readonly boolean[],
  row: DayRow,
  timing: BlockTiming,
  format: TimeFormat,
): Kind {
  const tag = dayTag(cells, row, timing);
  const hours = rangeText(cellsToWindows(row.date, cells, timing), timing.zone, format) ?? '';
  return tag === undefined || tag === 'some'
    ? { key: `hours:${hours}`, tag: undefined, hours }
    : { key: tag, tag, hours };
}

/** "6–9:30 pm" or "daytime": what a day has, in the middle of a sentence. */
const inSentence = (kind: Kind) => (kind.tag === undefined ? kind.hours : IN_SENTENCE[kind.tag]!());

/**
 * Days that differ, said short (SUS-206): the time most days share, then the
 * exceptions. "Evenings, but daytime on Tue 20 and 6–9:30 pm on Thu 22". Past
 * three exceptions it is counts instead: "8 evenings, 4 daytimes". A tie goes
 * to the time the earlier day has.
 */
function differing(
  state: Pick<EditorState, 'days'>,
  tapped: readonly number[],
  rows: readonly DayRow[],
  timing: BlockTiming,
  format: TimeFormat,
  locale?: string,
): string {
  const groups: { kind: Kind; days: number[] }[] = [];
  for (const day of tapped) {
    const kind = kindOf(state.days[day] ?? [], rows[day]!, timing, format);
    const group = groups.find((g) => g.kind.key === kind.key);
    if (group === undefined) groups.push({ kind, days: [day] });
    else group.days.push(day);
  }
  // Most days first; `sort` is stable, so a tie keeps the earlier day first.
  const ranked = [...groups].sort((a, b) => b.days.length - a.days.length);
  const [lead, ...others] = ranked as [(typeof groups)[number], ...typeof groups];
  const exceptions = others.reduce((count, g) => count + g.days.length, 0);

  if (exceptions <= 3) {
    const said = [...others]
      .sort((a, b) => a.days[0]! - b.days[0]!)
      .map((g) =>
        t('availability', 'line_exception', {
          what: inSentence(g.kind),
          days: dayList(
            g.days.map((day) => dayName(rows[day]!.date, locale)),
            'and',
          ),
        }),
      );
    const exceptionsText =
      said.length > 1
        ? t('availability', 'days_and', {
            rest: said.slice(0, -1).join(', '),
            last: said[said.length - 1]!,
          })
        : said[0]!;
    const first = lead.kind.tag === undefined ? lead.kind.hours : LEAD[lead.kind.tag]!();
    return t('availability', 'line_but', { lead: first, exceptions: exceptionsText });
  }

  return ranked
    .map((g) => {
      const counted = g.kind.tag === undefined ? undefined : COUNTED[g.kind.tag];
      return counted === undefined
        ? t('availability', 'count_hours', { count: g.days.length, hours: g.kind.hours })
        : counted(g.days.length);
    })
    .join(', ');
}

/**
 * The answer in two lines, or undefined while no day is tapped. When every
 * tapped day has the same block it is named ("Evenings, from 5:30 pm"; on a plan
 * with one window, by the band: "Mornings, 9 am–12 pm"); one time that is not a
 * block says its hours; days that differ give the time most share and the
 * exceptions (`shared` is false, and Change time opens the screen that sets
 * each day).
 */
export function answerLineOf(
  state: Pick<EditorState, 'days'>,
  rows: readonly DayRow[],
  timing: BlockTiming,
  format: TimeFormat,
  locale?: string,
  /** The band's name when the plan leaves only one window. */
  band?: BandName,
): AnswerLine | undefined {
  const tapped = tappedDays(state);
  if (tapped.length === 0) return undefined;
  const days = dayList(tappedNames(state, rows, locale), 'commas');

  const tags = tapped.map((day) => dayTag(state.days[day] ?? [], rows[day]!, timing));
  const first = tags[0];
  if (first !== undefined && first !== 'some' && tags.every((tag) => tag === first)) {
    const row = rows[tapped[0]!]!;
    const kind = first;
    if (kind === 'any_time')
      return { days, time: t('availability', 'line_any_time'), shared: true };
    // On a plan with one window, the band says what it is: mornings, afternoons.
    const word =
      kind === 'daytime' && band === 'mornings'
        ? t('availability', 'line_morning')
        : kind === 'daytime' && band === 'afternoons'
          ? t('availability', 'line_afternoon')
          : WORD[kind]!();
    const time = readsFromStart(kind)
      ? t('availability', 'line_from', { word, time: startsAt(kind, row, timing, format) })
      : t('availability', 'line_between', { word, time: hoursOf(kind, row, timing, format) });
    return { days, time, shared: true };
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
      return { days, time: t('availability', 'line_exact', { time: hours }), shared: true };
  }
  return {
    days,
    time: differing(state, tapped, rows, timing, format, locale),
    shared: false,
  };
}
