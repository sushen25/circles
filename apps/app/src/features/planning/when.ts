import { formatMinutesOfDay, fromISO, toLocal, zone as toZone } from '@circles/domain';

import { deviceTimeFormat } from '../availability/days';

/**
 * An instant as a person reads it, in the circle's zone: "Tue 15 Sep, 6 pm".
 *
 * The device's locale decides the order and the clock (manifesto §6); the zone
 * is the circle's, because a deadline is the same moment for everybody in it
 * and "6 pm" means Melbourne's six o'clock to a group that meets in Melbourne.
 */
function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone });
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/** "Tue 15 Sep". */
export function dayWords(iso: string, zone: string): string {
  return formatter(zone, { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(iso))
    .replace(',', '');
}

/**
 * "Tue 15 Sep, 6 pm" or "Tue 15 Sep, 18:00": the one way a moment is written
 * for the circle (SUS-204). The time is the domain's `formatMinutesOfDay` on
 * the device's 12- or 24-hour preference, the same words the candidate cards
 * and the availability editor use, so no two screens write one deadline two
 * ways.
 */
export function whenWords(iso: string, zone: string): string {
  const at = fromISO(iso);
  let local;
  try {
    local = toLocal(at, toZone(zone));
  } catch {
    local = toLocal(at, toZone(new Intl.DateTimeFormat().resolvedOptions().timeZone));
  }
  return `${dayWords(iso, zone)}, ${formatMinutesOfDay(local.minutesOfDay, deviceTimeFormat())}`;
}
