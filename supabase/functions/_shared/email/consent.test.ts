import {
  CONSENT,
  CONSENT_NO_ACCOUNT,
  CONSENT_VERSIONS,
  consentFor,
  consentTextFor,
  isKnownConsentVersion,
} from '@circles/config';
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
    // Every plan letter is "Emails about this meetup" now, so this holds the list of kinds,
    // not the wording: a kind added to SUBSCRIBER_KINDS fails here until somebody reads the
    // sentence and confirms the new letter is about one meetup and carries a stop link.
    // Both sentences of the trimmed card: the switch on and the switch off.
    for (const shown of [CONSENT, CONSENT_NO_ACCOUNT]) {
      expect(Object.keys(shown.covers).sort()).toEqual([...SUBSCRIBER_KINDS].sort());
      for (const kind of SUBSCRIBER_KINDS) {
        expect(shown.text, kind).toContain(shown.covers[kind]);
      }
    }
  });

  it('promises the nudge exactly where an account is made, and nowhere else', () => {
    // The nudge (`about_time`) goes to an account holder (ADR 0067) and its email has a stop
    // link (ADR 0069). The switch-on sentence says it; the switch-off one makes no account
    // and must not.
    expect(CONSENT.text).toContain(CONSENT.alsoCovers.about_time);
    expect(CONSENT_NO_ACCOUNT.text).not.toMatch(/nudge/i);
    expect(CONSENT.text).toMatch(/Stop any time\.$/);
    expect(CONSENT_NO_ACCOUNT.text).toMatch(/Stop any time\.$/);
    // The card picks by whether the person has or is making an account.
    expect(consentFor(true)).toBe(CONSENT);
    expect(consentFor(false)).toBe(CONSENT_NO_ACCOUNT);
    // The nudge is a real email kind for the nudge's recipient, needing no plan subscription.
    const nudge = NOTIFICATION_KINDS.find((spec) => spec.kind === 'about_time');
    expect(nudge?.channels).toContain('email');
    expect(nudge?.audience).toBe('nudge_recipient');
    expect(nudge?.emailNeedsSubscription).toBe(false);
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
      '2026-10-24': 'b7dbc09b3c08309fbb12516c26a268f899a669e350fc1567f55f1c35acdb2bb9',
      '2026-10-24-no-account': 'e4ce07c68fd40694a9bed8b07947dce614fd31b85925156f212254054280f9ab',
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

  it('shows today the last two versions on the list, and every version turns back into words', () => {
    // The two sentences of the trimmed card are the newest entries (SUS-250).
    const [account, noAccount] = CONSENT_VERSIONS.slice(-2);
    expect(CONSENT.version).toBe(account?.version);
    expect(CONSENT.text).toBe(account?.text);
    expect(CONSENT_NO_ACCOUNT.version).toBe(noAccount?.version);
    expect(CONSENT_NO_ACCOUNT.text).toBe(noAccount?.text);
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
