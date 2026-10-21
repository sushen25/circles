import { describe, expect, it } from 'vitest';

import { parseSourceRef } from './source-ref.js';

describe('parseSourceRef', () => {
  it.each([
    'tt-always-the-one-3',
    'rd-rpg-scheduling-boss',
    'cmp-doodle',
    'tt-bio',
    'ig-bio',
    'rd-profile',
    'a',
    'x'.repeat(40),
    '2026-10',
  ])('keeps %s', (tag) => {
    expect(parseSourceRef(tag)).toBe(tag);
  });

  it.each([
    '',
    'x'.repeat(41),
    'TT-Upper',
    'has space',
    'under_score',
    'a.b',
    'tt/slash',
    'maya@example.com',
    'tt-ünï',
    ' tt-pad',
    'tt-trailing\n',
  ])('drops %j', (tag) => {
    expect(parseSourceRef(tag)).toBeUndefined();
  });

  it('drops what is not a string', () => {
    expect(parseSourceRef(undefined)).toBeUndefined();
    expect(parseSourceRef(null)).toBeUndefined();
    expect(parseSourceRef(['tt-a'])).toBeUndefined();
    expect(parseSourceRef(3)).toBeUndefined();
  });
});
