import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { zoneNoteOf } from './words';

/**
 * Whose clock a time is written on (spec §5.6, ADR 00XX): the circle's, with
 * the zone named exactly when the reader's own device is somewhere else. Node
 * re-reads `TZ` on change, so the device is moved by setting it.
 */

const ZONE = 'Australia/Melbourne';

describe('zoneNoteOf', () => {
  const home = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = ZONE;
  });
  afterEach(() => {
    if (home === undefined) delete process.env.TZ;
    else process.env.TZ = home;
  });

  it('says nothing to a reader whose device is on the circle’s clock', () => {
    expect(zoneNoteOf(ZONE)).toBeUndefined();
  });

  it('names the circle’s zone to a reader whose device is elsewhere', () => {
    process.env.TZ = 'Europe/London';
    expect(zoneNoteOf(ZONE)).toBe('Times are Melbourne time.');
  });

  it('writes the city as a place, not as an identifier', () => {
    expect(zoneNoteOf('America/Los_Angeles')).toBe('Times are Los Angeles time.');
  });
});
