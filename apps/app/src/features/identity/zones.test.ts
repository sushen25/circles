import { describe, expect, it } from 'vitest';

import { cityOf, filterZones, groupZones, supportedZones, zoneLabel } from './zones';
import { afterNaming, destinationAfterSignIn } from './afterSignIn';

describe('the time-zone list', () => {
  it('groups zones by region and names each by its city', () => {
    const groups = groupZones([
      'Europe/London',
      'Australia/Melbourne',
      'America/Argentina/Buenos_Aires',
      'Australia/Adelaide',
    ]);
    expect(groups.map((g) => g.region)).toEqual(['America', 'Australia', 'Europe']);
    expect(groups[1]!.zones).toEqual([
      { id: 'Australia/Adelaide', city: 'Adelaide' },
      { id: 'Australia/Melbourne', city: 'Melbourne' },
    ]);
    expect(groups[0]!.zones[0]!.city).toBe('Buenos Aires');
  });

  it('leaves out what is not a place', () => {
    const groups = groupZones(['UTC', 'Etc/GMT+10', 'GMT', 'Europe/Paris']);
    expect(groups.flatMap((g) => g.zones.map((z) => z.id))).toEqual(['Europe/Paris']);
  });

  it('always offers the zone already chosen', () => {
    const groups = groupZones(['Europe/Paris'], 'Pacific/Chatham');
    expect(groups.flatMap((g) => g.zones.map((z) => z.id))).toContain('Pacific/Chatham');
  });

  it('filters by city or by id, ignoring case and underscores', () => {
    const groups = groupZones(['America/New_York', 'Europe/London', 'America/Denver']);
    expect(filterZones(groups, 'new york').flatMap((g) => g.zones.map((z) => z.id))).toEqual([
      'America/New_York',
    ]);
    expect(filterZones(groups, 'EUROPE').flatMap((g) => g.zones.map((z) => z.id))).toEqual([
      'Europe/London',
    ]);
    expect(filterZones(groups, '  ')).toHaveLength(2);
  });

  it('only lists zones Intl itself accepts', () => {
    for (const id of supportedZones().slice(0, 50)) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: id })).not.toThrow();
    }
  });

  it('labels a zone with its city and short name', () => {
    expect(cityOf('Australia/Melbourne')).toBe('Melbourne');
    expect(zoneLabel('Australia/Melbourne', new Date('2026-07-01T00:00:00Z'))).toMatch(
      /^Melbourne( \(.+\))?$/,
    );
  });
});

describe('after signing in', () => {
  it('goes back to the plan link it came from, whatever else is true', () => {
    expect(destinationAfterSignIn({ next: '/j/abcdefgh', hasName: false, hasCircles: true })).toBe(
      '/j/abcdefgh',
    );
  });

  it('asks a new account its name', () => {
    expect(destinationAfterSignIn({ hasName: false, hasCircles: false })).toBe('/name');
  });

  it('skips the name for a returning account, to its circles or its first', () => {
    expect(destinationAfterSignIn({ hasName: true, hasCircles: true })).toBe('/circles');
    expect(destinationAfterSignIn({ hasName: true, hasCircles: false })).toBe('/circles/new');
    expect(afterNaming(false)).toBe('/circles/new');
  });
});
