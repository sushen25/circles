/**
 * What somebody agreed to when they asked for plan-update email, and when the
 * wording last changed.
 *
 * `private.email_subscriptions.consent_text_version` is `not null` for a reason
 * the Spam Act cares about: a consent record that cannot say *what* was agreed
 * is not a record of consent, it is a note that somebody once clicked
 * something. So the sentence lives here, versioned, and the version is stored
 * with every subscription.
 *
 * Here rather than in `apps/app/src/copy` — which is where user-facing strings
 * belong (non-negotiable 6) — because this one is not only shown. It is
 * *recorded*, by a server the app is not running on, against a row that has to
 * outlive the screen it was agreed on. The screen renders `CONSENT.text`; it
 * does not write its own.
 *
 * **Changing the words means a new version**, never an edit in place. An old
 * subscription keeps the version it consented to, and a version that quietly
 * changed meaning would make every record before it a lie.
 *
 * Two tests hold this in place (`supabase/functions/_shared/email/consent.test.ts`):
 * every plan-update letter (`SUBSCRIBER_KINDS`) has a phrase in `covers` that
 * the sentence contains, so a new kind cannot ship without somebody reading
 * the sentence; and each version is pinned to a hash of its words, so editing
 * the text without a new version fails.
 *
 * Versions so far:
 * - `2026-09-14`: locked in, changed, called off, the reminder and the
 *   morning-after question. It did not name the letter that asks somebody to
 *   add their times again after an edit (`asked_again`, ADR 0046).
 * - `2026-10-02`: the same, naming that letter too.
 *
 * Add a version by appending to `CONSENT_VERSIONS` and pointing `CONSENT` at it.
 */
const TEXT_2026_09_14 =
  'Email me about this meetup only — when it is locked in, changed or called ' +
  'off, a reminder two hours before, and one question the morning after. ' +
  'Nothing else, and you can stop it from any of those emails without ' +
  'signing in.';

const TEXT_2026_10_02 =
  'Email me about this meetup only — when it is locked in, changed or called ' +
  'off, if I need to add my times again after a change, a reminder two hours ' +
  'before, and one question the morning after. Nothing else, and you can stop ' +
  'it from any of those emails without signing in.';

/**
 * Every version of the sentence that has ever been shown, with its words, oldest
 * first. A subscription stores the version it was made under, and the client
 * sends the version it rendered (ADR 0048), so the server accepts exactly the
 * versions on this list and any recorded version can be turned back into words.
 *
 * **Append only.** Never remove or edit an entry: a version that is gone is a
 * record that cannot say what was agreed. A test pins each entry's text to a
 * hash, and requires `CONSENT` to be the last one.
 */
export const CONSENT_VERSIONS = [
  { version: '2026-09-14', text: TEXT_2026_09_14 },
  { version: '2026-10-02', text: TEXT_2026_10_02 },
] as const;

/** The words a recorded version stands for, or undefined for a version never shown. */
export function consentTextFor(version: string): string | undefined {
  return CONSENT_VERSIONS.find((entry) => entry.version === version)?.text;
}

/** Whether `version` is one that was shown to somebody, and so may be recorded. */
export function isKnownConsentVersion(version: string): boolean {
  return consentTextFor(version) !== undefined;
}

/** The sentence the screen shows today: the last entry of `CONSENT_VERSIONS`. */
export const CONSENT = {
  /**
   * The date the wording was settled, which sorts and reads. Not a number:
   * `v2` tells you nothing about whether it is older than the row beside it.
   */
  version: '2026-10-02',
  scope: 'plan_updates',
  text: TEXT_2026_10_02,
  /**
   * For each plan-update letter, the words in `text` that say it will come.
   * Keyed by the email kind's name (`SUBSCRIBER_KINDS` in the Edge Functions'
   * email types, which this package cannot import); a test ties the two.
   */
  covers: {
    locked_in: 'locked in',
    changed: 'changed',
    cancelled: 'called off',
    reminder: 'a reminder two hours before',
    did_it_happen_participant: 'one question the morning after',
    asked_again: 'add my times again',
  },
} as const;

export type Consent = typeof CONSENT;
