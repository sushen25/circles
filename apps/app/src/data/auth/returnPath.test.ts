import { describe, expect, it } from 'vitest';

import { safeReturnPath } from './returnPath';

describe('safeReturnPath', () => {
  it('keeps a plan link on this origin', () => {
    expect(safeReturnPath('/j/abcdefgh')).toBe('/j/abcdefgh');
    expect(safeReturnPath('/p/k7mn2q3r')).toBe('/p/k7mn2q3r');
  });

  it('takes the first value when the router hands back an array', () => {
    expect(safeReturnPath(['/p/abcdefgh', '/elsewhere'])).toBe('/p/abcdefgh');
  });

  it.each([
    ['a full URL', 'https://elsewhere.example/j/abcdefgh'],
    ['a protocol-relative URL', '//elsewhere.example/j/abcdefgh'],
    ['a backslash the browser reads as a slash', '/\\elsewhere.example'],
    ['a path somewhere else in the app', '/settings/account'],
    ['the invite route, whose fragment is a secret', '/join'],
    ['a code that is not a short code', '/j/ABC!'],
    ['a code with a query', '/j/abcdefgh?x=1'],
    ['a code with a fragment', '/j/abcdefgh#secret'],
    ['a deeper path', '/j/abcdefgh/sent'],
    ['nothing', undefined],
    ['an empty string', ''],
    ['a number', 42],
  ])('refuses %s', (_why, value) => {
    expect(safeReturnPath(value)).toBeUndefined();
  });
});
