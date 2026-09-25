/**
 * "After work", "all evening", "any time that day" (spec §5.5).
 *
 * These exist because painting ten cells is still work, and most answers are
 * one of five shapes. Each is intersected with the plan's daily band, so a
 * shortcut can never offer a time the plan was not asking about — "morning" on
 * an evenings-only plan gives nothing rather than something outside it.
 */

import type { PlanTiming } from '../planning/types.js';
import type { Instant } from '../shared/instant.js';
import { type Interval, intersect, interval } from '../shared/interval.js';
import type { LocalDate } from '../shared/local-date.js';
import { fromLocal, fromLocalEnd, toLocal } from '../shared/zone.js';

export type ShortcutKind = 'after_work' | 'all_evening' | 'morning' | 'afternoon' | 'any_time';

/** Local minutes-of-day, before the plan's band is applied. */
const SHORTCUT_BANDS: Record<ShortcutKind, { startMin: number; endMin: number } | 'whole_day'> = {
  after_work: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
  all_evening: { startMin: 17 * 60 + 30, endMin: 24 * 60 },
  morning: { startMin: 9 * 60, endMin: 12 * 60 },
  afternoon: { startMin: 12 * 60, endMin: 17 * 60 },
  any_time: 'whole_day',
};

/**
 * The shortcut for one day, or `undefined` when it does not overlap the plan's
 * band at all. `undefined` rather than an empty window: the caller should hide
 * a shortcut that cannot do anything rather than offer one that silently does
 * nothing.
 */
export function applyShortcut(
  kind: ShortcutKind,
  date: LocalDate,
  plan: PlanTiming,
): Interval | undefined {
  const dayBand = interval(
    fromLocal(date, plan.daily.startMin, plan.zone),
    fromLocalEnd(date, plan.daily.endMin, plan.zone),
  );

  const band = SHORTCUT_BANDS[kind];
  if (band === 'whole_day') return dayBand;

  // `all_evening` runs to midnight, which `fromLocal` cannot express as a
  // minute of the same day. Clamped to the band's end, which is what it means:
  // the whole evening the plan is asking about.
  const endMin = Math.min(band.endMin, plan.daily.endMin);
  if (endMin <= band.startMin) return undefined;

  const wanted = interval(
    fromLocal(date, band.startMin, plan.zone),
    fromLocalEnd(date, endMin, plan.zone),
  );

  return intersect(dayBand, wanted) ?? undefined;
}

/** Which shortcuts can do anything on this day, so the UI hides the rest. */
export function availableShortcuts(date: LocalDate, plan: PlanTiming): ShortcutKind[] {
  const kinds = Object.keys(SHORTCUT_BANDS) as ShortcutKind[];
  return kinds.filter((kind) => applyShortcut(kind, date, plan) !== undefined);
}

/**
 * Tonight's two shortcuts (S2-06): **From now** and **Later tonight**.
 *
 * On a plan about this evening, Morning / Afternoon / Evening are the wrong
 * question — it is already whichever of them it is. What somebody answering
 * at 7:40 pm wants to say is "any time from now" or "not until later".
 *
 * - `from_now`: from the next half hour (or the band's start, if that is
 *   later) to the end of the band.
 * - `later_tonight`: from 9 pm, or an hour after "from now" begins if that is
 *   later, to the end of the band — so the two are never the same hours.
 *
 * `undefined` where the shortcut has no half hour left, as `applyShortcut`.
 */
export type TonightShortcutKind = 'from_now' | 'later_tonight';

export const LATER_TONIGHT_FROM_MIN = 21 * 60;
const HALF_HOUR_MIN = 30;

export function applyTonightShortcut(
  kind: TonightShortcutKind,
  date: LocalDate,
  plan: PlanTiming,
  now: Instant,
): Interval | undefined {
  const local = toLocal(now, plan.zone);
  // Before the day, the whole band is still ahead; after it, none is.
  const nowMin =
    local.date < date ? 0 : local.date > date ? Number.POSITIVE_INFINITY : local.minutesOfDay;
  const fromNow = Math.max(plan.daily.startMin, Math.ceil(nowMin / HALF_HOUR_MIN) * HALF_HOUR_MIN);
  const startMin =
    kind === 'from_now' ? fromNow : Math.max(LATER_TONIGHT_FROM_MIN, fromNow + 2 * HALF_HOUR_MIN);
  if (!Number.isFinite(startMin) || startMin >= plan.daily.endMin) return undefined;
  return interval(
    fromLocal(date, startMin, plan.zone),
    fromLocalEnd(date, plan.daily.endMin, plan.zone),
  );
}
