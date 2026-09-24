import {
  formatMinutesOfDay,
  localDate,
  type DurationMinutes,
  type PlanCategory,
  type WindowPreset,
} from '@circles/domain';

import { t } from '../../copy';
import { dateWords } from '../availability/days';
import { listOf } from '../scheduling/sentences';
import { nameList } from '../scheduling/names';
import type { DeadlineChoice } from './deadlines';
import { bandWords, deviceTimeFormat } from './firstPlan';
import type { Band, ResolveProblem } from './form';

/**
 * What the plan screens say, from the copy file and the plan. Kept apart from
 * the flows so the sentences can be read in one place and tested without a
 * screen.
 */

export function presetLabel(preset: WindowPreset): string {
  switch (preset) {
    case 'tonight':
      return t('planSetup', 'tonight');
    case 'this_weekend':
      return t('planSetup', 'this_weekend');
    case 'next_7_days':
      return t('planSetup', 'next_7_days');
    case 'next_14_days':
      return t('planSetup', 'next_14_days');
    case 'custom':
      return t('planSetup', 'custom');
  }
}

export function categoryLabel(category: PlanCategory): string {
  switch (category) {
    case 'catch_up':
      return t('planSetup', 'catch_up');
    case 'dinner':
      return t('planSetup', 'dinner');
    case 'drinks':
      return t('planSetup', 'drinks');
    case 'coffee':
      return t('planSetup', 'coffee');
    case 'activity':
      return t('planSetup', 'activity');
  }
}

export function durationLabel(duration: DurationMinutes): string {
  switch (duration) {
    case 60:
      return t('planSetup', '1_hr');
    case 90:
      return t('planSetup', '1_5_hrs');
    case 120:
      return t('planSetup', '2_hrs');
    case 180:
      return t('planSetup', '3_hrs');
    case 240:
      return t('planSetup', '4_hrs');
    case 300:
      return t('planSetup', '5_hrs');
  }
}

/** "Mon 14 – Sun 27 Sep" style, as the device writes dates; one day on its own. */
export function datesWords(range: { start: string; end: string }): string {
  const from = dateWords(localDate(range.start), 'short');
  if (range.start === range.end) return from;
  return t('customWindow', 'range', { from, to: dateWords(localDate(range.end), 'short') });
}

export function timeWords(minutes: number): string {
  return formatMinutesOfDay(minutes, deviceTimeFormat());
}

export { bandWords };

export function bandLine(band: Band): string {
  return t('planSetup', 'band_line', { time: bandWords(band) });
}

/** "At least 4 of 6 need to make it", or without the total when it would read oddly. */
export function quorumLine(quorum: number, members: number): string {
  return quorum <= members
    ? t('planSetup', 'quorum_of', { count: quorum, total: members })
    : t('planSetup', 'quorum_at_least', { count: quorum });
}

/** "Replies close in 3 days" — how long, from the moment the screen was opened. */
export function closesIn(deadline: string, now: number): string {
  const minutes = Math.max(0, Math.round((Date.parse(deadline) - now) / 60_000));
  if (minutes < 55) return t('planSetup', 'closes_in_minutes', { count: minutes });
  if (minutes < 90) return t('planSetup', 'closes_in_an_hour');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('planSetup', 'closes_in_hours', { count: hours });
  return t('planSetup', 'closes_in_days', { count: Math.round(hours / 24) });
}

export function deadlineChoiceLabel(choice: DeadlineChoice): string {
  switch (choice) {
    case 'hour':
      return t('planSetup', 'deadline_hour');
    case 'day':
      return t('planSetup', 'deadline_day');
    case 'two_days':
      return t('planSetup', 'deadline_two_days');
    case 'three_days':
      return t('planSetup', 'deadline_three_days');
    case 'latest':
      return t('planSetup', 'deadline_latest');
  }
}

/** Why the form cannot be sent, pointing at the control that is wrong. */
export function problemWords(problem: ResolveProblem): string {
  switch (problem) {
    case 'too_late_for_tonight':
      return t('planSetup', 'problem_too_late_for_tonight');
    case 'window_has_passed':
      return t('planSetup', 'problem_window_has_passed');
    case 'band_shorter_than_meetup':
      return t('planSetup', 'problem_band_shorter_than_meetup');
    case 'window_too_long':
    case 'window_backwards':
      return t('planSetup', 'problem_window');
    case 'band_backwards':
    case 'band_unaligned':
    case 'band_out_of_day':
      return t('planSetup', 'problem_band');
    case 'deadline_out_of_range':
      return t('planSetup', 'problem_deadline');
  }
}

/**
 * The re-ask warning (spec §5.3), from the preview's own lists. Two lists,
 * because being asked twice is a different imposition from being asked once:
 * "…Priya and Tom will be asked for their times again, and Alex gets a fresh
 * ask". Names up to three, then a count (`nameList`, S1-27), so a circle of
 * twenty reads as a sentence.
 */
export function reaskWarning(askedAgain: string[], freshAsk: string[]): string {
  const again = listOf(askedAgain);
  const fresh = listOf(freshAsk);
  // "you get", not "you gets": a lone "you" takes the plural verb.
  const one = nameList(freshAsk).kind === 'one' && freshAsk[0] !== t('planSetup', 'you');
  if (again !== undefined && fresh !== undefined) {
    return one
      ? t('editPlan', 'warn_again_fresh_one', { name: again, other: fresh })
      : t('editPlan', 'warn_again_fresh_many', { name: again, other: fresh });
  }
  if (again !== undefined) return t('editPlan', 'warn_again', { name: again });
  if (fresh !== undefined) {
    return one
      ? t('editPlan', 'warn_fresh_one', { other: fresh })
      : t('editPlan', 'warn_fresh_many', { other: fresh });
  }
  return t('editPlan', 'warn_nobody');
}
