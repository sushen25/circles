import { CONSENT, CONSENT_VERSIONS, consentTextFor, isKnownConsentVersion } from '@circles/config';
import { NOTIFICATION_KINDS } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { SUBSCRIBER_KINDS } from './types.ts';

/**
 * What somebody agrees to when they ask for plan-update email is `CONSENT.text`
 * (ADR 0019), and the Spam Act relies on the record being true in both
 * directions: the words they saw, and the letters they then get.
 */
describe('the consent sentence', () => {
  it('names every plan-update letter', () => {
    // Adding a kind to SUBSCRIBER_KINDS without reading the sentence fails here,
    // and so does a `covers` phrase the sentence does not contain.
    expect(Object.keys(CONSENT.covers).sort()).toEqual([...SUBSCRIBER_KINDS].sort());
    for (const kind of SUBSCRIBER_KINDS) {
      expect(CONSENT.text, kind).toContain(CONSENT.covers[kind]);
    }
  });

  it('names every kind the domain says needs a subscription to be emailed', () => {
    // What decides who is mailed is the domain's table, not the renderer's
    // footer list; a subscription-gated kind missing from SUBSCRIBER_KINDS
    // would otherwise slip past the test above.
    const gated = NOTIFICATION_KINDS.filter(
      (spec) => spec.channels.includes('email') && spec.emailNeedsSubscription,
    ).map((spec) => spec.kind);
    expect(Object.keys(CONSENT.covers).sort()).toEqual([...gated].sort());
  });

  it('pins every version in the list to its words: new words need a new version', async () => {
    // Append a line for a new version; never change an existing one.
    const pinned: Record<string, string> = {
      '2026-09-14': '3856889b9710a73294328c72e5ff563384dcd10238dfd8a5ee3ded4b4360ad15',
      '2026-10-02': 'c359f8fd2957e5a32d4d945bab3c93bc8a1143ba08c2fdba06f23f061e7663d1',
      '2026-10-06': '38f85e9aa83f8f26e62a6bf5b7e81d2a0a2058b68f2cc8e74433fb9860959c29',
    };
    // A version dropped from the list is a record that can no longer be read.
    expect(CONSENT_VERSIONS.map((entry) => entry.version)).toEqual(Object.keys(pinned));
    for (const entry of CONSENT_VERSIONS) {
      const bytes = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(entry.text),
      );
      const digest = [...new Uint8Array(bytes)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      expect(digest, entry.version).toBe(pinned[entry.version]);
    }
  });

  it('shows today the last version on the list, and every version turns back into words', () => {
    const last = CONSENT_VERSIONS[CONSENT_VERSIONS.length - 1];
    expect(CONSENT.version).toBe(last?.version);
    expect(CONSENT.text).toBe(last?.text);
    for (const entry of CONSENT_VERSIONS) {
      expect(consentTextFor(entry.version)).toBe(entry.text);
      expect(isKnownConsentVersion(entry.version)).toBe(true);
    }
    // Versions sort as dates and are unique.
    const versions = CONSENT_VERSIONS.map((entry) => entry.version);
    expect([...versions].sort()).toEqual(versions);
    expect(new Set(versions).size).toBe(versions.length);
    expect(consentTextFor('2099-01-01')).toBeUndefined();
    expect(isKnownConsentVersion('')).toBe(false);
  });
});
