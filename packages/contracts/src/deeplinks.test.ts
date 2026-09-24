import { describe, expect, it } from 'vitest';

import {
  emailPreferencesUrl,
  emailVerifyUrl,
  fragmentLinkKind,
  notificationSettingsUrl,
  parseJoinLink,
  parseTokenLink,
  planUrl,
  reentryUrl,
  type OpaqueToken,
  type ShortCode,
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

  it('reads a malformed escape as no token, rather than throwing at start-up (round 1)', () => {
    expect(parseTokenLink('https://example.test/v#%')).toBeNull();
    expect(parseJoinLink('https://example.test/join#%E0%A4%A')).toBeNull();
  });

  it('reads nothing from a link with no usable token', () => {
    expect(parseTokenLink('https://example.test/v')).toBeNull();
    expect(parseTokenLink('https://example.test/v#short')).toBeNull();
  });
});

describe('the plan link', () => {
  it('is /p/<code> on the origin, with no fragment to carry anything else', () => {
    expect(planUrl('https://example.test/', 'pnemab' as ShortCode)).toBe(
      'https://example.test/p/pnemab',
    );
  });
});

describe('the notification settings link', () => {
  it('is a plain path with nothing after it: no token, no fragment, no reader', () => {
    // ADR 0029: an organiser turns organiser email off where they are signed
    // in, so the letter's link says where and carries nothing.
    expect(notificationSettingsUrl('https://example.test/')).toBe(
      'https://example.test/settings/notifications',
    );
    expect(fragmentLinkKind('/settings/notifications')).toBeNull();
  });
});
