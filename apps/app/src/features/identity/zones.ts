/**
 * The time-zone picker's list: IANA zones grouped by region (S1-22).
 *
 * The zones are the runtime's own (`Intl.supportedValuesOf`), so the picker
 * never offers one that `Intl` — and therefore the domain's `zone()` and the
 * database's `enforce_iana_zone` — would refuse. Where the runtime cannot list
 * them (older Hermes), a short list of the zones most people are in stands in,
 * and the zone already chosen is always included so it can be seen as chosen.
 */
export type ZoneOption = { id: string; city: string };
export type ZoneGroup = { region: string; zones: ZoneOption[] };

const FALLBACK = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'America/Vancouver',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Darwin',
  'Australia/Hobart',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Dublin',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Rome',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

/** The regions a person would look under. `Etc/…` and the bare aliases are not places. */
const REGIONS = new Set([
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
]);

export function supportedZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] };
  try {
    const listed = intl.supportedValuesOf?.('timeZone');
    if (listed !== undefined && listed.length > 0) return listed;
  } catch {
    // Fall through to the short list.
  }
  return FALLBACK;
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function cityOf(id: string): string {
  const last = id.split('/').pop() ?? id;
  return last.replace(/_/g, ' ');
}

export function groupZones(zones: readonly string[], include?: string): ZoneGroup[] {
  const all = new Set(zones);
  if (include !== undefined) all.add(include);

  const byRegion = new Map<string, ZoneOption[]>();
  for (const id of all) {
    const region = id.split('/')[0] ?? '';
    if (!REGIONS.has(region) || !id.includes('/')) continue;
    const list = byRegion.get(region) ?? [];
    list.push({ id, city: cityOf(id) });
    byRegion.set(region, list);
  }

  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, list]) => ({
      region,
      zones: list.sort((a, b) => a.city.localeCompare(b.city)),
    }));
}

/** The groups, keeping only zones whose city or id contains `query`. */
export function filterZones(groups: readonly ZoneGroup[], query: string): ZoneGroup[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q === '') return [...groups];
  return groups
    .map((group) => ({
      region: group.region,
      zones: group.zones.filter(
        (zone) =>
          zone.city.toLowerCase().includes(q) ||
          zone.id.toLowerCase().replace(/_/g, ' ').includes(q),
      ),
    }))
    .filter((group) => group.zones.length > 0);
}

/**
 * "Melbourne (AEST)" — the city and the zone's short name as this device
 * writes it today. The short name falls back to an offset ("GMT+10") where the
 * locale has no abbreviation, and is left off if the runtime gives nothing.
 */
export function zoneLabel(id: string, at: Date = new Date()): string {
  const city = cityOf(id);
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZone: id, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    return part === undefined || part === '' ? city : `${city} (${part})`;
  } catch {
    return city;
  }
}
