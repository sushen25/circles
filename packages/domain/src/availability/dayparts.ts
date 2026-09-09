/**
 * What times a person usually says yes to (ADR 0005).
 *
 * Used in Slice 2 to pre-fill the painter: someone who has offered weekday
 * evenings three times running should not have to paint them a fourth. It is a
 * suggestion, never an answer — the pre-fill is editable and a person who has
 * never responded gets the plan's defaults.
 *
 * Deliberately coarse. Six buckets is enough to be useful and too few to feel
 * like being watched, which matters for a product whose promise is that
 * nobody sees your schedule (spec §5.5).
 */

import type { UserId } from '../circles/types.js';
import type { Interval } from '../shared/interval.js';
import { isWeekend } from '../shared/local-date.js';
import { type Zone, toLocal } from '../shared/zone.js';
import type { Response } from './types.js';

export type DayPart =
  | 'weekday_morning'
  | 'weekday_afternoon'
  | 'weekday_evening'
  | 'weekend_morning'
  | 'weekend_afternoon'
  | 'weekend_evening';

const NOON = 12 * 60;
const EVENING = 17 * 60;
const END_OF_DAY = 24 * 60;

const BANDS = [
  { part: 'morning', startMin: 0, endMin: NOON },
  { part: 'afternoon', startMin: NOON, endMin: EVENING },
  { part: 'evening', startMin: EVENING, endMin: END_OF_DAY },
] as const;

/** The daypart a moment falls in. Where a window *starts*, not what it covers. */
export function dayPartOf(window: Interval, zone: Zone): DayPart {
  const local = toLocal(window.start, zone);
  const weekend = isWeekend(local.date);
  const part =
    local.minutesOfDay < NOON ? 'morning' : local.minutesOfDay < EVENING ? 'afternoon' : 'evening';
  return `${weekend ? 'weekend' : 'weekday'}_${part}` as DayPart;
}

/**
 * Every daypart the window actually covers.
 *
 * A window is not a point. Someone who offers 09:00–22:30 has offered their
 * morning, afternoon and evening, and recording only the daypart it began in
 * would pre-fill the next plan with a third of what they said — the failure
 * being that the omission looks like a preference.
 *
 * Bands are compared in local minutes, so a window is attributed to the parts
 * of the day the person experienced, not to UTC.
 */
export function dayPartsCovered(window: Interval, zone: Zone): DayPart[] {
  const start = toLocal(window.start, zone);
  const end = toLocal(window.end, zone);

  // A window ending at local midnight lands on the next date at 0 minutes.
  const endMin = end.date === start.date ? end.minutesOfDay : end.minutesOfDay + END_OF_DAY;
  const prefix = isWeekend(start.date) ? 'weekend' : 'weekday';

  return BANDS.filter((band) => start.minutesOfDay < band.endMin && endMin > band.startMin).map(
    (band) => `${prefix}_${band.part}` as DayPart,
  );
}

export type DayPartSummary = {
  readonly userId: UserId;
  /** Most-offered first. Ties broken by the fixed order of `DayPart`. */
  readonly parts: readonly DayPart[];
  readonly counts: Readonly<Record<DayPart, number>>;
};

const ORDER: readonly DayPart[] = [
  'weekday_morning',
  'weekday_afternoon',
  'weekday_evening',
  'weekend_morning',
  'weekend_afternoon',
  'weekend_evening',
];

function emptyCounts(): Record<DayPart, number> {
  return {
    weekday_morning: 0,
    weekday_afternoon: 0,
    weekday_evening: 0,
    weekend_morning: 0,
    weekend_afternoon: 0,
    weekend_evening: 0,
  };
}

/**
 * One summary per member who has offered windows.
 *
 * Members who answered `flexible`, `none_work` or `not_this_time` are absent
 * rather than present with zeroes: "no pattern yet" and "a pattern of nothing"
 * are different, and only the first should fall back to the plan's defaults.
 */
export function summariseDayparts(
  responses: readonly Response[],
  zone: Zone,
): readonly DayPartSummary[] {
  const byMember = new Map<UserId, Record<DayPart, number>>();

  for (const response of responses) {
    if (response.status !== 'windows' || response.windows.length === 0) continue;

    const counts = byMember.get(response.userId) ?? emptyCounts();
    for (const window of response.windows) {
      for (const part of dayPartsCovered(window, zone)) {
        counts[part] += 1;
      }
    }
    byMember.set(response.userId, counts);
  }

  return [...byMember.entries()].map(([userId, counts]) => ({
    userId,
    counts,
    parts: ORDER.filter((part) => counts[part] > 0).sort((a, b) => {
      const difference = counts[b] - counts[a];
      return difference !== 0 ? difference : ORDER.indexOf(a) - ORDER.indexOf(b);
    }),
  }));
}
