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

/** "Tue 15 Sep, 6 pm" — the minutes dropped on the hour in a 12-hour clock. */
export function whenWords(iso: string, zone: string): string {
  const time = formatter(zone, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/:00(?=\s?[AaPp]\.?\s?[Mm])/, '');
  return `${dayWords(iso, zone)}, ${time}`;
}
