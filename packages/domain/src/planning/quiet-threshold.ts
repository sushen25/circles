/**
 * The quiet ask's one crossing: from `seeking` into a plan (spec §5.4.5).
 *
 * "Exactly once" is the database's row lock (architecture §6.2). What is here
 * is the rule the lock protects — when an ask may open, what it opens into —
 * and the one case SUS-89 left to this module: an ask at its threshold while
 * the circle already has a plan finding a time (ADR 0033) is *held*, not
 * opened and not closed (ADR 00XX).
 */

import type { UserId } from '../circles/types.js';
import { build } from '../shared/build.js';
import type { Instant } from '../shared/instant.js';
import { type Result, err, ok } from '../shared/result.js';
import { defaultDeadline, lastPossibleStart } from './deadline.js';
import {
  type QuietAsk,
  type QuietError,
  type QuietRefusal,
  isAsking,
  keenCount,
  thresholdMet,
} from './quiet.js';
import type { QuietPreset } from './quiet-stop-time.js';
import { type Actor, canTransition } from './state-machine.js';
import type { Plan } from './types.js';

const refuse = <T>(code: QuietRefusal): Result<QuietError, T> => err({ code });

export type QuietStep = 'cross' | 'expire' | 'wait' | 'none';

/**
 * What the dispatcher should do with a quiet ask on its sweep.
 *
 * An ask at its threshold beside an open plan is *held* (ADR 00XX): it stays
 * `seeking`, shows nothing, and opens on the first sweep or answer after the
 * circle's open plan finishes. If its stop time comes first it closes like any
 * other — before its stop time it may cross, from it only expire.
 */
export function nextQuietStep(ask: QuietAsk, now: Instant, circleHasOpenPlan?: boolean): QuietStep {
  const { plan } = ask;
  if (plan.mode !== 'quiet' || plan.state !== 'seeking') return 'none';
  if (!isAsking(plan, now)) return 'expire';
  return thresholdMet(ask) && circleHasOpenPlan === false ? 'cross' : 'wait';
}

/** For the rows `threshold_reached` and `expire`, which no person fires. */
export const NOBODY: Actor = {
  userId: '',
  isPermanent: false,
  isMember: false,
  isOrganiser: false,
  isOwner: false,
};

export type ThresholdContext = {
  /** The window the ask was made with. `Plan` does not keep it; the deadline default needs it. */
  readonly preset: QuietPreset;
  readonly now: Instant;
  readonly circleHasOpenPlan?: boolean | undefined;
};

export type Opened = {
  readonly plan: Plan;
  /**
   * The keen members, the initiator among them, to be prompted to choose times
   * — not marked available, because keen is not a time. **Server-side only**:
   * this list *is* the individual answers, and it exists to address
   * notifications, never to be shown or logged.
   */
  readonly initialResponders: readonly UserId[];
};

/**
 * Open the ask into a plan (spec §5.4.5): `collecting`, with no organiser, and
 * a response deadline defaulted from the window as of *now* — the moment it
 * opened, not the moment it was asked, because that is when people are first
 * asked for times.
 */
export function onThreshold(ask: QuietAsk, context: ThresholdContext): Result<QuietError, Opened> {
  const { plan } = ask;
  if (plan.mode !== 'quiet') return refuse('not_quiet');
  if (plan.state === 'seeking' && !isAsking(plan, context.now)) return refuse('interest_closed');
  // The table carries `no_open_plan` on this row too (SUS-89); checking it here
  // as well keeps "held" a quiet-ask rule the module states itself.
  if (plan.state === 'seeking' && context.circleHasOpenPlan !== false) {
    return refuse('plan_in_progress');
  }

  const moved = canTransition(plan, 'threshold_reached', {
    actor: NOBODY,
    keenCount: keenCount(ask),
  });
  if (!moved.ok) return moved;

  const deadline = defaultDeadline(context.preset, context.now, lastPossibleStart(plan));
  if (deadline === undefined) return refuse('window_has_passed');

  // No organiser until somebody accepts (§8.2). A seeking ask never has one;
  // clearing it anyway means a row that somehow did cannot carry it across.
  const opened = build(moved.value, { organiserUserId: undefined, responseDeadline: deadline });
  const initialResponders = [...ask.answers]
    .filter(([, answer]) => answer === 'keen')
    .map(([id]) => id);
  return ok({ plan: opened, initialResponders });
}
