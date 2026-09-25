/**
 * When a conversion prompt may be shown (spec §5.11, the guest → app flow).
 *
 * Every prompt obeys the same rules, and they are here so that no screen and no
 * Edge Function has a copy of its own: after a value moment, one tap to dismiss,
 * at most once per moment per plan, at most one per session, and after two
 * "not now"s on an app prompt nothing for 30 days. Installed members never see
 * an app prompt.
 *
 * `record-nudge` runs this over the person's `nudge_states` rows before it
 * records a prompt as shown, and answers `suppressed` when it says skip — so a
 * prompt shown on a phone is not shown again on a laptop. The client runs it
 * first over what it knows locally (who is here, whether this session has had
 * a prompt already), so it does not ask the server about a prompt that could
 * never be shown. Neither is a security boundary: a client that ignores the
 * caps can only nag itself.
 */

import { type Instant, compare } from '../shared/instant.js';

/**
 * The moments, and the only values `nudge_states.moment` accepts (migration
 * 0028 renders this list into its constraint, and `150_analytics.sql` holds the
 * two to each other).
 *
 * - `sent_save_access` — times sent: the email-updates card, with "save access
 *   on every device" under it. The card's once-per-plan record.
 * - `reattached_save_place` — after a Continue-as from the list: "Keep your
 *   place for good?".
 * - `after_attendance_start_circle` — the morning after, "I was there" on the
 *   circle's first happened meetup: "Start a circle for another group".
 * - `organiser_gate` — a guest about to organise: save your place first. A
 *   gate rather than a nudge; recorded so the conversion map can be read.
 * - `reattached_twice_app`, `locked_in_app`, `email_given_app`,
 *   `second_response_app` — the app prompts (Slice 3). One cap group.
 */
export const NUDGE_MOMENTS = [
  'after_attendance_start_circle',
  'email_given_app',
  'locked_in_app',
  'organiser_gate',
  'reattached_save_place',
  'reattached_twice_app',
  'second_response_app',
  'sent_save_access',
] as const;

export type NudgeMoment = (typeof NUDGE_MOMENTS)[number];

export function isNudgeMoment(value: string): value is NudgeMoment {
  return (NUDGE_MOMENTS as readonly string[]).includes(value);
}

/**
 * Which rules a moment is held to.
 *
 * - `offer` — the email card on Sent. Once per plan and nothing else: it is
 *   the anonymous guest's own column of the map, not a conversion, so it
 *   neither spends nor respects the one-per-session budget.
 * - `saved_place` — the two prompts to save a place. Once, and one per session.
 * - `gate` — the organiser gate. Never capped: organising needs it.
 * - `app` — the four app prompts. One per session, and the 30-day back-off.
 */
export type NudgeGroup = 'offer' | 'saved_place' | 'gate' | 'app';

const GROUP: Record<NudgeMoment, NudgeGroup> = {
  sent_save_access: 'offer',
  reattached_save_place: 'saved_place',
  after_attendance_start_circle: 'saved_place',
  organiser_gate: 'gate',
  reattached_twice_app: 'app',
  locked_in_app: 'app',
  email_given_app: 'app',
  second_response_app: 'app',
};

export function nudgeGroupOf(moment: NudgeMoment): NudgeGroup {
  return GROUP[moment];
}

/**
 * Whether a moment's row names a plan.
 *
 * Every moment but the gate is about one. The two reattach moments are too —
 * the plan whose link the person came back through — and that is what lets
 * their history travel: `move_membership` moves a membership's plan-bound
 * rows to the identity that reattached, so the second reattach, on the third
 * browser, knows about the first. The gate is about organising, which is not
 * yet a plan.
 */
export function isPlanBoundMoment(moment: NudgeMoment): boolean {
  return moment !== 'organiser_gate';
}

/** Who is being asked. `app` is a person using the installed app. */
export type IdentityTier = 'guest' | 'saved' | 'app';

/** One `nudge_states` row, as the rules need it. */
export interface NudgeRecord {
  readonly moment: NudgeMoment;
  readonly planId: string | null;
  readonly shownAt: Instant;
  readonly answer: 'dismissed' | 'tapped' | null;
  /** When the answer was given; `updated_at`. Null while there is none. */
  readonly answeredAt: Instant | null;
}

/** What the rules need to know about this moment beyond the history. */
export interface NudgeContext {
  /** The plan the moment is about. Required for a plan-bound moment. */
  readonly planId?: string | undefined;
  /** This session has shown a capped prompt already. The client's to say. */
  readonly shownThisSession?: boolean | undefined;
  /**
   * For `after_attendance_start_circle`: the person has said "I was there" to
   * this plan, and no other meetup of the circle is known to have happened.
   * The server's to say (`after_attendance_facts`); absent is "not known yet",
   * which the client's pre-check lets through and the server does not.
   */
  readonly attendedFirstInCircle?: boolean | undefined;
}

export type SkipReason =
  /** App prompts are for people without the app. */
  | 'installed'
  /** A saved-place prompt, or the gate, for somebody who has a saved place. */
  | 'already_saved'
  /** A plan-bound moment asked about without a plan. */
  | 'needs_plan'
  /** Shown before: this moment and plan, or the ask it counts as. */
  | 'already_shown'
  /** One capped prompt per session, and this session has had it. */
  | 'session_cap'
  /** Two app prompts turned down; nothing for 30 days. */
  | 'backed_off'
  /** The moment has not happened: no first reattach to follow, no "I was there". */
  | 'not_the_moment';

export type NudgeDecision =
  { readonly kind: 'show' } | { readonly kind: 'skip'; readonly reason: SkipReason };

export const APP_BACK_OFF_DAYS = 30;
/** A second reattach within this long is when the app sheet replaces "save your place". */
export const REATTACH_AGAIN_DAYS = 30;
/** A circle started this long after "Start a circle" was tapped counts as its result. */
export const STARTED_CIRCLE_DAYS = 30;

const DAY_MILLIS = 24 * 60 * 60 * 1000;

function daysAfter(at: Instant, days: number): Instant {
  return (at + days * DAY_MILLIS) as Instant;
}

/**
 * The spec's "the email-then-app prompt and the locked-in nudge count as the
 * same ask": on one plan, one of the two, whichever came first.
 */
const SAME_ASK: Partial<Record<NudgeMoment, readonly NudgeMoment[]>> = {
  email_given_app: ['email_given_app', 'locked_in_app'],
  locked_in_app: ['email_given_app', 'locked_in_app'],
};

/** Moments shown at most once per person rather than once per plan. */
const ONCE_PER_PERSON: ReadonlySet<NudgeMoment> = new Set([
  'reattached_save_place',
  'reattached_twice_app',
  'organiser_gate',
]);

/**
 * Until when the app prompts are held back, if they are.
 *
 * Walks the app group's "not now"s in the order they were said: every second
 * one starts 30 days of nothing. One said during a back-off cannot happen —
 * nothing was shown — so a count that restarts after each back-off is exactly
 * "after two not-nows, nothing for 30 days", again and again, and never a
 * permanent ban from two taps a year apart.
 */
export function appBackOffUntil(history: readonly NudgeRecord[]): Instant | undefined {
  const dismissals = history
    .filter((r) => nudgeGroupOf(r.moment) === 'app' && r.answer === 'dismissed')
    .map((r) => r.answeredAt ?? r.shownAt)
    .sort(compare);

  let until: Instant | undefined;
  let counted = 0;
  for (const at of dismissals) {
    if (until !== undefined && at < until) continue;
    counted += 1;
    if (counted === 2) {
      until = daysAfter(at, APP_BACK_OFF_DAYS);
      counted = 0;
    }
  }
  return until;
}

function tierAllows(moment: NudgeMoment, tier: IdentityTier): SkipReason | undefined {
  const group = nudgeGroupOf(moment);
  if (group === 'app' && tier === 'app') return 'installed';
  // Saving a place is for somebody who has not. The after-attendance prompt is
  // for everybody: a saved place is asked to start a circle too, and only the
  // guest meets the gate on the way.
  if ((moment === 'reattached_save_place' || group === 'gate') && tier !== 'guest') {
    return 'already_saved';
  }
  return undefined;
}

function shownBefore(
  moment: NudgeMoment,
  planId: string | undefined,
  history: readonly NudgeRecord[],
): boolean {
  if (ONCE_PER_PERSON.has(moment)) return history.some((r) => r.moment === moment);
  const counted = SAME_ASK[moment] ?? [moment];
  return history.some((r) => counted.includes(r.moment) && r.planId === planId);
}

/**
 * Show or skip, and why.
 *
 * The order is the order a person would give the reasons in: who you are
 * first, then whether this has been asked before, then whether you have been
 * asked too much lately.
 */
export function nudgeEligibility(
  moment: NudgeMoment,
  history: readonly NudgeRecord[],
  tier: IdentityTier,
  now: Instant,
  context: NudgeContext = {},
): NudgeDecision {
  const skip = (reason: SkipReason): NudgeDecision => ({ kind: 'skip', reason });

  const byTier = tierAllows(moment, tier);
  if (byTier !== undefined) return skip(byTier);

  const planId = context.planId;
  if (isPlanBoundMoment(moment) && (planId === undefined || planId === '')) {
    return skip('needs_plan');
  }

  // The gate is a gate: every time a guest reaches it, whatever came before.
  if (nudgeGroupOf(moment) === 'gate') return { kind: 'show' };

  if (shownBefore(moment, planId, history)) return skip('already_shown');

  if (moment === 'after_attendance_start_circle' && context.attendedFirstInCircle === false) {
    return skip('not_the_moment');
  }

  // The app sheet replaces "save your place" only on a reattach that follows
  // one within 30 days; otherwise there is nothing for it to follow.
  if (moment === 'reattached_twice_app') {
    const first = history.find((r) => r.moment === 'reattached_save_place');
    if (first === undefined || now >= daysAfter(first.shownAt, REATTACH_AGAIN_DAYS)) {
      return skip('not_the_moment');
    }
  }

  if (nudgeGroupOf(moment) !== 'offer' && context.shownThisSession === true) {
    return skip('session_cap');
  }

  if (nudgeGroupOf(moment) === 'app') {
    const until = appBackOffUntil(history);
    if (until !== undefined && now < until) return skip('backed_off');
  }

  return { kind: 'show' };
}

/**
 * Whether a prompt counts against the one-per-session budget once shown.
 * The email card and the gate do not (see `NudgeGroup`).
 */
export function spendsSessionBudget(moment: NudgeMoment): boolean {
  const group = nudgeGroupOf(moment);
  return group === 'saved_place' || group === 'app';
}

/**
 * Whether a circle made now is the result of "Start a circle" **by a guest**
 * (§11.2's "guests who start a new circle within 30 days"): the
 * after-attendance prompt was tapped not more than 30 days ago, and at the time
 * of the tap the person had no saved place yet.
 *
 * `savedSince` is when this identity got its saved place — its first
 * permanent sign-in method. A saved member is asked to start a circle too, and
 * without this their circles would be counted as guests' (review round 1).
 * Unknown is not credited: a guess inflates the number the metric exists to
 * read.
 */
export function startedCircleFromPrompt(
  history: readonly NudgeRecord[],
  now: Instant,
  savedSince: Instant | undefined,
): boolean {
  if (savedSince === undefined) return false;
  return history.some((r) => {
    if (r.moment !== 'after_attendance_start_circle' || r.answer !== 'tapped') return false;
    const tappedAt = r.answeredAt ?? r.shownAt;
    return tappedAt < savedSince && now < daysAfter(tappedAt, STARTED_CIRCLE_DAYS);
  });
}
