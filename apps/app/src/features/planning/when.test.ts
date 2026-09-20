import { describe, expect, it } from 'vitest';

import { dayWords, whenWords } from './when';

describe('whenWords', () => {
  it("reads the instant in the circle's zone, not the device's", () => {
    // 08:00 UTC is 6 pm in Melbourne (AEST, +10) on 15 September.
    const iso = '2026-09-15T08:00:00Z';
    expect(dayWords(iso, 'Australia/Melbourne')).toMatch(/15/);
    expect(dayWords(iso, 'Australia/Melbourne')).toMatch(/Sep/);
    expect(whenWords(iso, 'Australia/Melbourne')).toMatch(/(6|18)/);
    expect(whenWords(iso, 'America/New_York')).toMatch(/4/);
  });

  it('falls back to the device zone for a zone it does not know, rather than throwing', () => {
    expect(() => whenWords('2026-09-15T08:00:00Z', 'Not/AZone')).not.toThrow();
  });
});
