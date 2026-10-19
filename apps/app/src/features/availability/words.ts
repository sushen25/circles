import {
  formatMinutesOfDay,
  fromISO,
  localDate,
  toLocal,
  zone as toZone,
  type DayPart,
  type LocalDate,
  type TimeFormat,
} from '@circles/domain';

import { t } from '../../copy';
import type { AnswerablePlan } from '../../data/availability';
import type { BandName, BlockKind } from './blocks';
import { dateWords } from './days';

/**
 * The editor's sentences, from the copy file and the plan (spec §5.5). Kept
 * apart from the flow so that what the screen *says* can be read in one place.
 */

export const BLOCK_LABEL: Record<BlockKind, () => string> = {
  morning: () => t('availability', 'morning'),
  afternoon: () => t('availability', 'afternoon'),
  daytime: () => t('availability', 'daytime'),
  evening: () => t('availability', 'evening'),
  any_time: () => t('availability', 'any_time'),
  from_now: () => t('availability', 'from_now'),
  later_tonight: () => t('availability', 'later_tonight'),
};

/** The word for what a guest is tapping, from the plan's band: "evening", "day". */
const THING: Record<BandName, () => string> = {
  mornings: () => t('availability', 'thing_morning'),
  afternoons: () => t('availability', 'thing_afternoon'),
  evenings: () => t('availability', 'thing_evening'),
  days: () => t('availability', 'thing_day'),
};
export const thingOf = (band: BandName): string => THING[band]();

/** The same, plural, for the line under the question: "days", "evenings". */
const THINGS: Record<BandName, () => string> = {
  mornings: () => t('availability', 'things_morning'),
  afternoons: () => t('availability', 'things_afternoon'),
  evenings: () => t('availability', 'things_evening'),
  days: () => t('availability', 'things_day'),
};

/** The question the first screen asks: "Which evenings could work?", else "Which days…". */
export function questionOf(band: BandName, onlyChoice: boolean): string {
  if (!onlyChoice) return t('availability', 'which_days_could_work');
  if (band === 'evenings') return t('availability', 'which_evenings_could_work');
  if (band === 'mornings') return t('availability', 'which_mornings_could_work');
  if (band === 'afternoons') return t('availability', 'which_afternoons_could_work');
  return t('availability', 'which_days_could_work');
}

/** "None of these evenings work for me", where the plan has one band to name. */
export function noneOf(band: BandName, onlyChoice: boolean): string {
  if (onlyChoice && band === 'evenings')
    return t('availability', 'none_of_these_evenings_work_for_me');
  if (onlyChoice && band === 'mornings')
    return t('availability', 'none_of_these_mornings_work_for_me');
  if (onlyChoice && band === 'afternoons')
    return t('availability', 'none_of_these_afternoons_work_for_me');
  return t('availability', 'none_of_these_dates_work_for_me');
}

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
export function guideOf(counted: boolean, band: BandName, onlyChoice: boolean): string {
  const things = THINGS[onlyChoice ? band : 'days']();
  return counted
    ? t('availability', 'guide_counted', { things })
    : t('availability', 'guide_plain', { things });
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

const USUAL_WEEKDAY = ['weekday_morning', 'weekday_afternoon', 'weekday_evening'] as const;
const USUAL_WEEKEND = ['weekend_morning', 'weekend_afternoon', 'weekend_evening'] as const;

/**
 * What the usual is, in words, so the tap is not a surprise (SUS-227): "Weekday
 * evenings and weekend afternoons, from your last plans in this circle." Built
 * from the parts the read returned, never from a date or a count: a group with
 * all three parts of the day is "any time on weekdays".
 */
export function usualSaid(parts: readonly DayPart[]): string {
  const has = new Set<string>(parts);
  const phrases: string[] = [];
  for (const [group, all] of [
    [USUAL_WEEKDAY, 'usual_weekday_all'],
    [USUAL_WEEKEND, 'usual_weekend_all'],
  ] as const) {
    if (group.every((part) => has.has(part))) phrases.push(t('availability', all));
    else {
      for (const part of group) {
        if (has.has(part)) phrases.push(t('availability', `usual_${part}`));
      }
    }
  }
  const what =
    phrases.length < 2
      ? (phrases[0] ?? '')
      : t('availability', 'usual_and', {
          rest: phrases.slice(0, -1).join(', '),
          last: phrases[phrases.length - 1]!,
        });
  const line = t('availability', 'usual_says', { what });
  return line.charAt(0).toUpperCase() + line.slice(1);
}
