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
 * - `2026-10-06`: a shorter sentence for the one-step card on Sent (SUS-162):
 *   locked in, moved, called off or needs your times again, one reminder, one
 *   question after.
 * - `2026-10-24`: one short sentence for the trimmed card on Sent (SUS-250):
 *   "Emails about this meetup. Stop any time." It says the plan letters in one
 *   phrase (locked in, changed, moved, called off, needs your times again, the
 *   reminder and the question after), each of which has a stop link. The
 *   plan-the-next-one reminder an account holder gets is not in it: it is
 *   disclosed in `/privacy` (ADR 0067), by Sushen's decision (ADR 0092). The
 *   card briefly had two sentences, with and without that nudge; the second
 *   was never released, so nothing was recorded under it.
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

const TEXT_2026_10_06 =
  "Only about this meetup: when it's locked in, moved, called off or needs " +
  'your times again, one reminder, and one question after. Stop any time from ' +
  'the email itself.';

const TEXT_2026_10_24 = 'Emails about this meetup. Stop any time.';

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
  { version: '2026-10-06', text: TEXT_2026_10_06 },
  { version: '2026-10-24', text: TEXT_2026_10_24 },
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
  version: '2026-10-24',
  scope: 'plan_updates',
  text: TEXT_2026_10_24,
  /**
   * For each plan-update letter, the words in `text` that say it will come.
   * Keyed by the email kind's name (`SUBSCRIBER_KINDS` in the Edge Functions'
   * email types, which this package cannot import); a test ties the two.
   * Every plan letter is "email about this meetup": the sentence no longer
   * lists them one by one, and each carries its own stop link.
   */
  covers: {
    locked_in: 'Emails about this meetup',
    changed: 'Emails about this meetup',
    moved: 'Emails about this meetup',
    cancelled: 'Emails about this meetup',
    reminder: 'Emails about this meetup',
    did_it_happen_participant: 'Emails about this meetup',
    asked_again: 'Emails about this meetup',
  },
} as const;

export type Consent = typeof CONSENT;
