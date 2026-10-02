import { CONSENT } from '@circles/config';
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

  it('is pinned to its version: new words need a new version', async () => {
    // Append a line for a new version; never change an existing one.
    const pinned: Record<string, string> = {
      '2026-09-14': '3856889b9710a73294328c72e5ff563384dcd10238dfd8a5ee3ded4b4360ad15',
      '2026-10-02': 'c359f8fd2957e5a32d4d945bab3c93bc8a1143ba08c2fdba06f23f061e7663d1',
    };
    const bytes = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(CONSENT.text),
    );
    const digest = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(pinned[CONSENT.version], `no pin for version ${CONSENT.version}`).toBeDefined();
    expect(digest).toBe(pinned[CONSENT.version]);
  });
});
