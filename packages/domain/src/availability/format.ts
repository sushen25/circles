/**
 * "6:30–10:30 pm" — the range text beside each day row (spec §5.5).
 *
 * Formatting lives here rather than in the client because the same string goes
 * into email, into the share message and onto the screen, and three
 * implementations would drift. What does **not** live here is any sentence: the
 * copy around these fragments is in `apps/app/src/copy`.
 *
 * `hour12` is a parameter, never an assumption. Most of the world writes 18:30,
 * and a domain that hard-codes "pm" cannot be given a second locale later.
 */

import type { Interval } from '../shared/interval.js';
import { type Zone, toLocal } from '../shared/zone.js';

export type TimeFormat = {
  /** 12-hour with am/pm, or 24-hour. */
  readonly hour12: boolean;
};

const DEFAULT_FORMAT: TimeFormat = { hour12: true };

/** 1110 → "6:30 pm" or "18:30". Minutes are dropped on the hour in 12-hour. */
export function formatMinutesOfDay(
  minutesOfDay: number,
  format: TimeFormat = DEFAULT_FORMAT,
  withSuffix = true,
): string {
  const hours24 = Math.floor(minutesOfDay / 60) % 24;
  const minutes = minutesOfDay % 60;

  if (!format.hour12) {
    return `${String(hours24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const suffix = hours24 < 12 ? 'am' : 'pm';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const body = minutes === 0 ? `${hours12}` : `${hours12}:${String(minutes).padStart(2, '0')}`;
  return withSuffix ? `${body} ${suffix}` : body;
}

/**
 * "6:30–10:30 pm", "7–9:30 pm", "6:30 am–2 pm".
 *
 * The suffix is dropped from the start when both ends share it — "6:30–10:30
 * pm" is how a person writes it, and repeating "pm" twice reads like a form.
 */
export function formatRange(
  startMin: number,
  endMin: number,
  format: TimeFormat = DEFAULT_FORMAT,
): string {
  if (!format.hour12) {
    return `${formatMinutesOfDay(startMin, format)}–${formatMinutesOfDay(endMin, format)}`;
  }

  const sameHalf = Math.floor(startMin / 60) % 24 < 12 === Math.floor(endMin / 60) % 24 < 12;
  const start = formatMinutesOfDay(startMin, format, !sameHalf);
  return `${start}–${formatMinutesOfDay(endMin, format)}`;
}

/**
 * The row header for one day's windows, or `undefined` when nothing is painted
 * — the caller decides whether that reads as "Not this day" or as nothing at
 * all, because that is copy.
 */
export function rangeText(
  windows: readonly Interval[],
  zone: Zone,
  format: TimeFormat = DEFAULT_FORMAT,
): string | undefined {
  if (windows.length === 0) return undefined;

  return windows
    .map((w) => {
      const start = toLocal(w.start, zone);
      const end = toLocal(w.end, zone);
      // A window ending at local midnight lands on the next date at 0 minutes;
      // 24 * 60 is how a person reads it — "until midnight", not "until 0:00".
      const endMin = end.date === start.date ? end.minutesOfDay : end.minutesOfDay + 24 * 60;
      return formatRange(start.minutesOfDay, endMin, format);
    })
    .join(', ');
}
