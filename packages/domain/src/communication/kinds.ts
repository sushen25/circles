/**
 * Every message this product is allowed to send (spec §5.8, architecture §13).
 *
 * A closed set, as data. The dispatcher looks a kind up here rather than
 * carrying a switch of its own, and the list is short on purpose: "nothing
 * about activity, streaks or news, ever" is a product promise, and the way to
 * keep it is to make an unlisted kind unrepresentable rather than discouraged.
 *
 * The rows are the "Push copy" artboard's rows, in its order, plus the three the
 * spec names elsewhere: `replies_closed` (§5.7, §5.8), `verify_email`, and
 * `quiet_expired` (§5.4.7, the SparkExpired artboard, ADR 0038). No
 * sentence lives here — `copyKey` names one, and the copy package renders it
 * (non-negotiable 6).
 */

/** Where a message can go. Web-only participants reach email by subscription. */
export type Channel = 'push' | 'email';

export type NotificationKind =
  | 'new_plan'
  | 'quiet_ask'
  | 'threshold_initiator'
  | 'threshold_keen'
  | 'deadline_approaching'
  | 'options_ready'
  | 'replies_closed'
  | 'locked_in'
  | 'changed'
  | 'cancelled'
  | 'reminder'
  | 'did_it_happen'
  | 'about_time'
  | 'did_it_happen_participant'
  | 'verify_email'
  | 'quiet_expired';

/**
 * Who a kind goes to, named rather than described.
 *
 * The name is the link between this table and `eligibility.ts`: one place says
 * which rule applies, the other says what the rule is, and a kind cannot be
 * added here without an audience that resolves.
 */
export type Audience =
  | 'members'
  | 'members_except_initiator'
  | 'quiet_initiator'
  | 'keen_members'
  | 'non_responders'
  | 'organiser'
  | 'going_members'
  | 'subscribed_members'
  | 'nudge_recipient'
  | 'the_address';

export type NotificationSpec = {
  readonly kind: NotificationKind;
  readonly audience: Audience;
  /** In preference order: the first the recipient can actually receive wins. */
  readonly channels: readonly Channel[];
  /** The copy package's key. The sentence is there, never here. */
  readonly copyKey: string;
  /**
   * Whether email needs a **verified per-plan subscription** before it may be
   * used (spec §5.8, §8.2).
   *
   * True for the member kinds. Being in a circle is not consent to be emailed:
   * plan-update email is scoped to one plan, asked for explicitly, verified,
   * and never marketing consent. False for the organiser kinds, which the spec
   * sends by email "until they install the app" (review C6), and for
   * `verify_email`, which is the request for that consent.
   *
   * The rule lives in the table rather than in a comment because a comment is
   * what it was: `channels: ['push', 'email']` on `locked_in` had `channelFor`
   * picking email off a members list.
   */
  readonly emailNeedsSubscription: boolean;
  /**
   * Whether "Emails about plans you organise" on notification settings stops
   * this kind's **email** (ADR 0029). Push is untouched, and so is every kind
   * a subscription governs — that consent has its own stop link.
   *
   * True for `options_ready` and `did_it_happen`, the working mail of a plan
   * the organiser started. False for `replies_closed`, which still sends: it
   * is the one message saying a plan other people answered is waiting on the
   * organiser alone. False for `about_time`, whose switch is the per-circle
   * "Nudges to plan the next one".
   */
  readonly organiserEmailSwitch: boolean;
  /**
   * Whether this kind waits until 08:00 rather than arriving at 11 pm.
   *
   * False for `locked_in` and `cancelled` (spec §5.8: "quiet hours 9 pm–8 am
   * local **except confirmed and cancelled**") — a plan that just changed is
   * news you need before you leave the house, and holding it until morning is
   * worse than the buzz.
   *
   * `verify_email` is also exempt: somebody is standing at the screen waiting
   * for it, and a verification link that arrives nine hours later is a
   * verification link that has expired.
   */
  readonly respectsQuietHours: boolean;
};

/**
 * The table. `changed` respects quiet hours even though it is a sibling of
 * `cancelled` on the artboard: the spec's exception names *confirmed and
 * cancelled*, and "we are asking for new times" is not urgent at midnight.
 */
export const NOTIFICATION_KINDS: readonly NotificationSpec[] = [
  {
    kind: 'new_plan',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'members',
    channels: ['push'],
    copyKey: 'push.new_plan',
    respectsQuietHours: true,
  },
  {
    kind: 'quiet_ask',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'members_except_initiator',
    channels: ['push'],
    copyKey: 'push.quiet_ask',
    respectsQuietHours: true,
  },
  {
    // Push first, and the initiator's own confirmed address until they have
    // the app (ADR 0038): the role is offered to them, as the organiser kinds
    // are offered to an organiser (review C6). Their own address and nobody
    // else's, so no subscription: this is not a plan-update letter.
    kind: 'threshold_initiator',
    emailNeedsSubscription: false,
    organiserEmailSwitch: false,
    audience: 'quiet_initiator',
    channels: ['push', 'email'],
    copyKey: 'push.threshold_initiator',
    respectsQuietHours: true,
  },
  {
    kind: 'threshold_keen',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'keen_members',
    channels: ['push'],
    copyKey: 'push.threshold_keen',
    respectsQuietHours: true,
  },
  {
    kind: 'deadline_approaching',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'non_responders',
    channels: ['push'],
    copyKey: 'push.deadline_approaching',
    respectsQuietHours: true,
  },
  {
    // An organiser kind: email until they install the app (review C6, §13).
    kind: 'options_ready',
    emailNeedsSubscription: false,
    organiserEmailSwitch: true,
    audience: 'organiser',
    channels: ['push', 'email'],
    copyKey: 'push.options_ready',
    respectsQuietHours: true,
  },
  {
    // Not on the Pushes artboard, and required all the same: "replies closed
    // with no decision" is in the organiser's email list (spec §5.8) and is the
    // "one reminder at the deadline" of §5.7, which opens the DeadlinePassed
    // screen — lock in the top option, hand it over, or give it one more day.
    kind: 'replies_closed',
    emailNeedsSubscription: false,
    organiserEmailSwitch: false,
    audience: 'organiser',
    channels: ['push', 'email'],
    copyKey: 'push.replies_closed',
    respectsQuietHours: true,
  },
  {
    kind: 'locked_in',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'members',
    channels: ['push', 'email'],
    copyKey: 'push.locked_in',
    respectsQuietHours: false,
  },
  {
    kind: 'changed',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'members',
    channels: ['push', 'email'],
    copyKey: 'push.changed',
    respectsQuietHours: true,
  },
  {
    kind: 'cancelled',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'members',
    channels: ['push', 'email'],
    copyKey: 'push.cancelled',
    respectsQuietHours: false,
  },
  {
    kind: 'reminder',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'going_members',
    channels: ['push', 'email'],
    copyKey: 'push.reminder',
    respectsQuietHours: true,
  },
  {
    kind: 'did_it_happen',
    emailNeedsSubscription: false,
    organiserEmailSwitch: true,
    audience: 'organiser',
    channels: ['push', 'email'],
    copyKey: 'push.did_it_happen',
    respectsQuietHours: true,
  },
  {
    kind: 'about_time',
    emailNeedsSubscription: false,
    organiserEmailSwitch: false,
    audience: 'nudge_recipient',
    channels: ['push', 'email'],
    copyKey: 'push.about_time',
    respectsQuietHours: true,
  },
  {
    // The participant's half of "did it happen". §5.8 lists it among the five
    // plan-update emails a verified subscriber receives — they are the ones who
    // can say whether they were there — while the Pushes artboard's row is the
    // organiser's. Two kinds rather than one with two audiences: the push
    // version must never reach a subscriber, and a channel-dependent audience
    // is a rule you cannot read off the table.
    kind: 'did_it_happen_participant',
    emailNeedsSubscription: true,
    organiserEmailSwitch: false,
    audience: 'subscribed_members',
    channels: ['email'],
    copyKey: 'email.did_it_happen',
    respectsQuietHours: true,
  },
  {
    kind: 'verify_email',
    emailNeedsSubscription: false,
    organiserEmailSwitch: false,
    audience: 'the_address',
    channels: ['email'],
    copyKey: 'email.verify',
    respectsQuietHours: false,
  },
  {
    // "Not enough people were free this time" (spec §5.4.7, SparkExpired): an
    // ask that reached its stop time without opening, told to the one person
    // who knows it existed as theirs. Email only — there is no push row — and
    // to their own address (ADR 0038). A withdrawn ask has no letter at all:
    // its initiator closed it themselves (spec §9).
    kind: 'quiet_expired',
    emailNeedsSubscription: false,
    organiserEmailSwitch: false,
    audience: 'quiet_initiator',
    channels: ['email'],
    copyKey: 'email.quiet_expired',
    respectsQuietHours: true,
  },
];

const BY_KIND = new Map(NOTIFICATION_KINDS.map((spec) => [spec.kind, spec] as const));

export function notificationSpec(kind: NotificationKind): NotificationSpec {
  const spec = BY_KIND.get(kind);
  // The map is built from the table, so this is a kind added to the union
  // without a row — a programmer error, and one worth failing loudly on rather
  // than silently sending nothing.
  if (spec === undefined) throw new RangeError(`No notification spec for kind: ${kind}`);
  return spec;
}

/**
 * Whether this person's "Emails about plans you organise" switch stops this
 * kind's email (ADR 0029).
 *
 * One function for both halves of the dispatcher: `recipientsFor` asks it when
 * a job is written, and the sender asks it again when the job is due, because
 * `did_it_happen` is written at confirmation and sent the next morning — a
 * switch that did not reach what was already queued would stop nothing for a
 * day.
 */
export function organiserEmailStopped(kind: NotificationKind, switchedOff: boolean): boolean {
  return switchedOff && notificationSpec(kind).organiserEmailSwitch;
}

/**
 * The kinds a quiet ask must never leak through.
 *
 * Not a list of kinds to suppress — `quiet_ask` and `threshold_initiator` are
 * *sent*. It marks the ones whose copy and recipients could identify the
 * initiator, so that a template or an audience change to one of them is a
 * change somebody has to look at (spec §8.2).
 */
export const QUIET_SENSITIVE_KINDS: readonly NotificationKind[] = [
  'quiet_ask',
  'threshold_initiator',
  'threshold_keen',
  'quiet_expired',
];
