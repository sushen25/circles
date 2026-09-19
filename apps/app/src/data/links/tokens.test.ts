import { beforeEach, describe, expect, it } from 'vitest';

import { captureTokenFragment, heldToken, releaseToken } from './tokens';

/** ADR 0023: the token leaves the address bar before the router can copy it. */

// Made at run time: a fixed token-shaped literal is what a secret scanner looks for.
const TOKEN = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');

function open(url: string) {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  for (const kind of ['reentry', 'verify', 'preferences'] as const) releaseToken(kind);
});

describe('captureTokenFragment', () => {
  it.each([
    ['/v', 'verify'],
    ['/e', 'preferences'],
    ['/a', 'reentry'],
  ] as const)('takes %s#<token> out of the address bar and holds it as %s', (path, kind) => {
    open(`${path}#${TOKEN}`);

    captureTokenFragment();

    expect(heldToken(kind)).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('clears a malformed token too, and holds nothing', () => {
    open('/v#not-a-token');

    captureTokenFragment();

    expect(heldToken('verify')).toBeUndefined();
    expect(window.location.hash).toBe('');
  });

  it('leaves the invite, and every other path, to their own handling', () => {
    open(`/join#${TOKEN}`);
    captureTokenFragment();
    expect(window.location.hash).toBe(`#${TOKEN}`);

    open('/p/abcdefgh#section');
    captureTokenFragment();
    expect(window.location.hash).toBe('#section');
  });
});
