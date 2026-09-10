/**
 * "After work", "all evening", "any time that day" (spec §5.5).
 *
 * These exist because painting ten cells is still work, and most answers are
 * one of five shapes. Each is intersected with the plan's daily band, so a
 * shortcut can never offer a time the plan was not asking about — "morning" on
 * an evenings-only plan gives nothing rather than something outside it.
 */

import type { Plan } from '../planning/types.js';
import { type Interval, intersect, interval } from '../shared/interval.js';
import type { LocalDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';

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
  plan: Plan,
): Interval | undefined {
  const dayBand = interval(
    fromLocal(date, plan.daily.startMin, plan.zone),
    fromLocal(date, plan.daily.endMin, plan.zone),
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
    fromLocal(date, endMin, plan.zone),
  );

  return intersect(dayBand, wanted) ?? undefined;
}

/** Which shortcuts can do anything on this day, so the UI hides the rest. */
export function availableShortcuts(date: LocalDate, plan: Plan): ShortcutKind[] {
  const kinds = Object.keys(SHORTCUT_BANDS) as ShortcutKind[];
  return kinds.filter((kind) => applyShortcut(kind, date, plan) !== undefined);
}
