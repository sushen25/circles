import { formatMinutesOfDay, formatRange, fromISO, toLocal, zone as toZone } from '@circles/domain';

import { t } from '../../copy';
import { dateWords, deviceTimeFormat } from '../availability/days';

/**
 * How an option is written on a candidate card (spec §5.6).
 *
 * Every time on these screens is the **circle's** clock. A half hour means the
 * same moment to everybody in the circle, and a group that meets in Melbourne
 * reads "6:30 pm" as Melbourne's — so somebody away from home is told whose
 * clock it is (`zoneNote`) rather than shown a second one. The deadline is in
 * the circle's zone for the same reason and one more: circle home already
 * writes it that way, and two screens disagreeing about when replies close is
 * worse than either of them being in the wrong zone.
 *
 * The date order and the 12- or 24-hour clock are the device's, as everywhere
 * else (manifesto §6).
 */

/** "Thu 17 Sep". */
export function dateOf(iso: string, zone: string): string {
  return dateWords(toLocal(fromISO(iso), toZone(zone)).date, 'short');
}

/** "Thursday" — the day on its own, for a headline and a button. */
export function weekdayOf(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: zone }).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(iso));
  }
}

/** "6:30–8:30 pm". */
export function timeOf(startIso: string, endIso: string, zone: string): string {
  const z = toZone(zone);
  const start = toLocal(fromISO(startIso), z);
  const end = toLocal(fromISO(endIso), z);
  // A meetup that runs past midnight ends on the next day's clock, so the end
  // is pushed past 24:00 rather than wrapping to a smaller number.
  const endMin =
    end.minutesOfDay <= start.minutesOfDay && end.date !== start.date
      ? end.minutesOfDay + 24 * 60
      : end.minutesOfDay;
  return formatRange(start.minutesOfDay, endMin, deviceTimeFormat());
}

/** "Tue 15 Sep, 6 pm" — when replies close, in the circle's zone. */
export function deadlineOf(iso: string, zone: string): string {
  const local = toLocal(fromISO(iso), toZone(zone));
  return `${dateWords(local.date, 'short')}, ${formatMinutesOfDay(local.minutesOfDay, deviceTimeFormat())}`;
}

/**
 * "Times are Melbourne time." when **this device** is somewhere else — the same
 * sentence the availability editor shows, for the same reason (§9).
 *
 * **A known gap, and it is not this file's to close.** Spec §5.6 asks for the
 * zone "if any member differs", which is about the organiser knowing that
 * Thursday at six is four o'clock for Sam. No client can work that out: a
 * member's zone lives in `profiles`, readable by its owner alone, and
 * `member_profiles` exposes a name and an id and nothing else. So what ships
 * answers the reader's own question — whose clock is this? — and leaves the
 * organiser's unanswered. Closing it needs member zones in a readable view,
 * which is a migration, or an ADR narrowing the rule to the reader. Neither
 * belongs in a screen (non-negotiable 1).
 */
export function zoneNoteOf(zone: string): string | undefined {
  let here: string | undefined;
  try {
    here = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  if (here === undefined || here === zone) return undefined;
  const city = zone.split('/').pop()?.replaceAll('_', ' ') ?? zone;
  return t('candidates', 'times_in_zone', { zone: city });
}
