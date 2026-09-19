import { describe, expect, it } from 'vitest';

import {
  emailPreferencesUrl,
  emailVerifyUrl,
  fragmentLinkKind,
  parseTokenLink,
  reentryUrl,
  type OpaqueToken,
} from './index';

// Made at run time: a fixed token-shaped literal is what a secret scanner looks for.
const TOKEN = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(
  /-/g,
  '',
) as OpaqueToken;

describe('emailed links (ADR 0023)', () => {
  it('put the token in the fragment, which no server receives, and never in the path', () => {
    for (const url of [
      reentryUrl('https://example.test/', TOKEN),
      emailVerifyUrl('https://example.test', TOKEN),
      emailPreferencesUrl('https://example.test', TOKEN),
    ]) {
      const [beforeHash, hash] = url.split('#');
      expect(beforeHash).not.toContain(TOKEN);
      expect(hash).toBe(TOKEN);
      expect(parseTokenLink(url)?.token).toBe(TOKEN);
    }
  });

  it('knows which paths carry a capability in their fragment', () => {
    expect(fragmentLinkKind('/join')).toBe('invite');
    expect(fragmentLinkKind('/a/')).toBe('reentry');
    expect(fragmentLinkKind('/v')).toBe('verify');
    expect(fragmentLinkKind('/e')).toBe('preferences');
    expect(fragmentLinkKind('/p/abcdef')).toBeNull();
  });

  it('reads nothing from a link with no usable token', () => {
    expect(parseTokenLink('https://example.test/v')).toBeNull();
    expect(parseTokenLink('https://example.test/v#short')).toBeNull();
  });
});
