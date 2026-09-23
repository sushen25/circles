import { Platform } from 'react-native';

/**
 * Where "Open in Maps" goes (S1-28).
 *
 * The organiser's own link when they gave one — it is `http(s)` by the
 * database's check, and it is the place they meant. Otherwise a search for the
 * place's name in the maps app this device has: Apple Maps on iOS, the `geo:`
 * scheme on Android (which offers whichever maps app is installed), and Google
 * Maps in a browser anywhere else. With neither, nothing: a link that opens an
 * empty search is not a place.
 */
export type MapsDevice = 'ios' | 'android' | 'other';

export function mapsLink(
  place: { name?: string | undefined; url?: string | undefined },
  device: MapsDevice = mapsDevice(),
): string | undefined {
  if (place.url !== undefined && place.url !== '') return place.url;
  const name = place.name?.trim();
  if (name === undefined || name === '') return undefined;
  const q = encodeURIComponent(name);
  switch (device) {
    case 'ios':
      return `https://maps.apple.com/?q=${q}`;
    case 'android':
      return `geo:0,0?q=${q}`;
    case 'other':
      return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
}

/** Which kind of device this is, for maps — the platform, or on the web the browser's. */
export function mapsDevice(userAgent?: string): MapsDevice {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  const agent = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  // iPadOS reports itself as a Mac; a touch screen is what tells them apart.
  const touchMac =
    /Macintosh/.test(agent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(agent) || touchMac) return 'ios';
  if (/Android/.test(agent)) return 'android';
  return 'other';
}
