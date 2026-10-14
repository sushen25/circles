import {
  formatMinutesOfDay,
  fromISO,
  localDate,
  toLocal,
  zone as toZone,
  type LocalDate,
  type TimeFormat,
} from '@circles/domain';

import { t } from '../../copy';
import type { AnswerablePlan } from '../../data/availability';
import type { BlockKind } from './blocks';
import { dateWords, type RowWords } from './days';

/**
 * The editor's sentences, from the copy file and the plan (spec §5.5). Kept
 * apart from the flow so that what the screen *says* can be read in one place.
 */

export const BLOCK_LABEL: Record<BlockKind, () => string> = {
  morning: () => t('availability', 'morning'),
  afternoon: () => t('availability', 'afternoon'),
  evening: () => t('availability', 'evening'),
  any_time: () => t('availability', 'any_time'),
  from_now: () => t('availability', 'from_now'),
  later_tonight: () => t('availability', 'later_tonight'),
};

export const ROW_WORDS: RowWords = {
  cell: (day, from, to) => t('availability', 'cell', { day, from, to }),
  repeated: (label) => t('availability', 'cell_repeated', { label }),
  crossing: (label) => t('availability', 'cell_crossing', { label }),
  get clocksGoBack() {
    return t('availability', 'clocks_go_back');
  },
};

/** "Catch up · 14 Sep – 27 Sep", in the device's own date order. */
export function titleOf(plan: AnswerablePlan): string {
  const short = (date: LocalDate) =>
    new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
      new Date(`${date}T12:00:00Z`),
    );
  const dates = `${short(localDate(plan.windowStart))} – ${short(localDate(plan.windowEnd))}`;
  return t('availability', 'title', { title: plan.title, dates });
}

/** "Replies close Fri 23 Oct, 8:30 pm." — in the plan's zone, under the grid. */
export function closesOf(plan: AnswerablePlan, format: TimeFormat): string {
  const closes = toLocal(fromISO(plan.responseDeadline), toZone(plan.zone));
  return t('availability', 'replies_close', {
    deadline: `${dateWords(closes.date, 'short')}, ${formatMinutesOfDay(closes.minutesOfDay, format)}`,
  });
}

/**
 * The one line of guidance. With counts on the days it says what the number
 * means, the reader included once they tap; with none (nobody else has given
 * times, or the read failed) it says only what to do, because there is no
 * number to explain.
 */
export function guideOf(counted: boolean): string {
  return counted ? t('availability', 'guide_counted') : t('availability', 'guide_plain');
}

/**
 * "Times are Melbourne time." when this device is somewhere else. The grid is
 * the plan's zone's clock — a half hour means the same moment to everybody in
 * the circle — so somebody away from home is told whose clock it is (§9).
 */
export function zoneNoteOf(plan: AnswerablePlan): string | undefined {
  let here: string | undefined;
  try {
    here = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  if (here === undefined || here === plan.zone) return undefined;
  const city = plan.zone.split('/').pop()?.replaceAll('_', ' ') ?? plan.zone;
  return t('availability', 'times_in_zone', { zone: city });
}

/** "5:42 pm", on this device's clock: when *this person* saved it. */
export function timeOfDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}
