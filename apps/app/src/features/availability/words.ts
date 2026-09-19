import {
  formatMinutesOfDay,
  fromISO,
  localDate,
  toLocal,
  zone as toZone,
  type LocalDate,
  type ShortcutKind,
  type TimeFormat,
} from '@circles/domain';

import { t } from '../../copy';
import type { AnswerablePlan } from '../../data/availability';
import { dateWords, type RowWords } from './days';

/**
 * The editor's sentences, from the copy file and the plan (spec §5.5). Kept
 * apart from the flow so that what the screen *says* can be read in one place.
 */

export const SHORTCUT_LABEL: Record<Exclude<ShortcutKind, 'any_time'>, () => string> = {
  after_work: () => t('availability', 'after_work'),
  all_evening: () => t('availability', 'all_evening'),
  morning: () => t('availability', 'morning'),
  afternoon: () => t('availability', 'afternoon'),
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

const WHAT: Record<AnswerablePlan['category'], () => string> = {
  catch_up: () => t('availability', 'what_catch_up'),
  dinner: () => t('availability', 'what_dinner'),
  drinks: () => t('availability', 'what_drinks'),
  coffee: () => t('availability', 'what_coffee'),
  activity: () => t('availability', 'what_activity'),
};

const DURATION: Record<AnswerablePlan['durationMinutes'], () => string> = {
  60: () => t('availability', 'duration_60'),
  90: () => t('availability', 'duration_90'),
  120: () => t('availability', 'duration_120'),
  180: () => t('availability', 'duration_180'),
};

/** "Catch-ups run about 2 hours. Replies close Tue 15 Sep, 6 pm." — in the plan's zone. */
export function introOf(plan: AnswerablePlan, format: TimeFormat): string {
  const closes = toLocal(fromISO(plan.responseDeadline), toZone(plan.zone));
  return t('availability', 'runs_about', {
    what: WHAT[plan.category](),
    duration: DURATION[plan.durationMinutes](),
    deadline: `${dateWords(closes.date, 'short')}, ${formatMinutesOfDay(closes.minutesOfDay, format)}`,
  });
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
