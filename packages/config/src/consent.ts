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
 */
export const CONSENT = {
  /**
   * The date the wording was settled, which sorts and reads. Not a number:
   * `v2` tells you nothing about whether it is older than the row beside it.
   */
  version: '2026-09-14',
  scope: 'plan_updates',
  text:
    'Email me about this meetup only — when it is locked in, changed or called ' +
    'off, a reminder two hours before, and one question the morning after. ' +
    'Nothing else, and you can stop it from any of those emails without ' +
    'signing in.',
} as const;

export type Consent = typeof CONSENT;
