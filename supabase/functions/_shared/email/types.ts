import type { Instant, NotificationKind, Zone } from '@circles/domain';

/**
 * What the sender (S1-20's dispatcher) hands `render` for each kind of email.
 *
 * Ids and values, never a sentence: the words are `copy.ts`'s, and the links
 * are built inside `render` from the tokens below by the functions in
 * `@circles/contracts/deeplinks`, so no caller can put a token in a path by
 * hand (ADR 0023).
 *
 * **Tokens are minted at send time, for this one letter** (ADR 0020): the
 * verification token by `issueVerificationToken`, the re-entry token by
 * `issueReentryToken`, the preferences token by `issuePreferencesToken` — each
 * for the *contact* the letter is going to. The readable token lives in this
 * object for the length of one send and then in the email, and nowhere else.
 */

/** Every email: where links point, and the one name a subject may carry. */
type Base = {
  /** The app's origin, e.g. `https://meet.example.com`. No trailing path. */
  readonly origin: string;
  readonly circleName: string;
};

/** A plan-update email to a verified subscriber (spec §5.8). */
type ToSubscriber = Base & {
  /** The plan's short code, for `/p/<code>`. Not a token (ADR 0022). */
  readonly planCode: string;
  /** For both footer links. Minted for this letter. */
  readonly prefsToken: string;
  /**
   * The single-use way back in, or null for a saved-place identity —
   * `issueReentryToken` returns null for them, and the email leaves the line
   * out rather than failing.
   */
  readonly reentryToken: string | null;
};

/** An organiser kind, sent by email until they have the app (review C6). */
type ToOrganiser = Base & { readonly planCode: string };

export type VerifyEmailInput = Base & {
  readonly kind: 'verify_email';
  readonly verifyToken: string;
};

export type LockedInInput = ToSubscriber & {
  readonly kind: 'locked_in';
  readonly start: Instant;
  readonly end: Instant;
  readonly zone: Zone;
  readonly placeName?: string | undefined;
  /** The organiser's note from the confirm screen, and whose it is. */
  readonly note?: string | undefined;
  readonly organiserName?: string | undefined;
};

export type ChangedInput = ToSubscriber & {
  readonly kind: 'changed';
  /** The confirmed start that is now off. */
  readonly previousStart: Instant;
  readonly zone: Zone;
};

export type CancelledInput = ToSubscriber & {
  readonly kind: 'cancelled';
  /** The confirmed start, when there was one. A plan can be called off before. */
  readonly start?: Instant | undefined;
  readonly zone: Zone;
  readonly note?: string | undefined;
  readonly organiserName?: string | undefined;
};

export type ReminderInput = ToSubscriber & {
  readonly kind: 'reminder';
  readonly start: Instant;
  readonly zone: Zone;
  readonly placeName?: string | undefined;
  /** A count, never names. */
  readonly goingCount: number;
};

export type DidItHappenParticipantInput = ToSubscriber & {
  readonly kind: 'did_it_happen_participant';
  readonly start: Instant;
  readonly zone: Zone;
};

export type OptionsReadyInput = ToOrganiser & {
  readonly kind: 'options_ready';
  /** The top candidate's start. */
  readonly bestStart: Instant;
  readonly zone: Zone;
  /** How many can make it. */
  readonly availableCount: number;
};

export type RepliesClosedInput = ToOrganiser & { readonly kind: 'replies_closed' };

export type DidItHappenInput = ToOrganiser & {
  readonly kind: 'did_it_happen';
  readonly start: Instant;
  readonly zone: Zone;
};

export type AboutTimeInput = Base & {
  readonly kind: 'about_time';
  /** For `/circles/<id>`: about-time is about a circle, not a plan. */
  readonly circleId: string;
  /** Whole weeks since the circle last met. */
  readonly weeksSince: number;
};

export type EmailInput =
  | VerifyEmailInput
  | LockedInInput
  | ChangedInput
  | CancelledInput
  | ReminderInput
  | DidItHappenParticipantInput
  | OptionsReadyInput
  | RepliesClosedInput
  | DidItHappenInput
  | AboutTimeInput;

/** The kinds that can be emailed. The other five are push-only (`kinds.ts`). */
export type EmailKind = EmailInput['kind'];

/** Checked, so a kind added to the domain's email channel cannot go unrendered. */
export const EMAIL_KINDS = [
  'verify_email',
  'locked_in',
  'changed',
  'cancelled',
  'reminder',
  'did_it_happen_participant',
  'options_ready',
  'replies_closed',
  'did_it_happen',
  'about_time',
] as const satisfies readonly NotificationKind[];

/** The plan-update kinds, which carry the two footer links and a re-entry link. */
export const SUBSCRIBER_KINDS = [
  'locked_in',
  'changed',
  'cancelled',
  'reminder',
  'did_it_happen_participant',
] as const satisfies readonly EmailKind[];

/** What `render` returns, ready for `sendEmail`. */
export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
  /** The plain-text alternative, from the same tree as the HTML. */
  readonly text: string;
  /**
   * `List-Unsubscribe` for the plan-update kinds (RFC 2369): the preferences
   * link. No `List-Unsubscribe-Post` — see `render.tsx`.
   */
  readonly headers: Readonly<Record<string, string>>;
};
