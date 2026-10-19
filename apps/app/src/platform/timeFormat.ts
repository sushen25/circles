import type { TimeFormat } from '@circles/domain';

/**
 * The device's own clock: 18:30 for most of the world, 6:30 pm for some
 * (manifesto §6). The one place the app asks the device which it is; every
 * time of day is then written by the domain's `formatMinutesOfDay` and
 * `formatRange`, never by `Intl.DateTimeFormat` with an `hour` (a test holds
 * that line: `timeWriters.test.ts`).
 */
export function deviceTimeFormat(): TimeFormat {
  try {
    const options = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    if (options.hour12 !== undefined) return { hour12: options.hour12 };
    if (options.hourCycle !== undefined) {
      return { hour12: options.hourCycle === 'h11' || options.hourCycle === 'h12' };
    }
  } catch {
    // A runtime without Intl's resolved options. The canvas's 12-hour clock.
  }
  return { hour12: true };
}
