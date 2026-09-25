/**
 * What happens to a quiet ask after it is made: somebody takes the organiser
 * role, it runs out of time, or its initiator calls it off (spec §5.4).
 *
 * Each is a row of the transition table with a quiet-ask rule in front of it.
 * The table is the authority on *whether a move exists*; these say which of
 * the moves it allows the quiet ask actually means.
 */

import { type Instant, isBefore } from '../shared/instant.js';
import { type Result, err } from '../shared/result.js';
import type { QuietError, QuietRefusal } from './quiet.js';
import { NOBODY } from './quiet-threshold.js';
import { type Actor, canTransition } from './state-machine.js';
import type { Plan } from './types.js';

const refuse = (code: QuietRefusal): Result<QuietError, Plan> => err({ code });

/**
 * How somebody comes to organise a quiet plan (spec §5.4.5).
 *
 * - `initiator`: the private **I'll organise** on ThresholdRole.
 * - `volunteer`: a keen member's **I'll pick the time**.
 * - `owner_fallback`: the circle owner, after replies closed with nobody in the
 *   role — the "quiet nudge" the Volunteer artboard promises.
 *
 * **A request-time argument, never a stored or reported fact.** `initiator`
 * next to the user id that became organiser is the initiator's identity; the
 * organiser's name is public by design (§4.5), how they came to it is not.
 */
export type OrganiserSource = 'initiator' | 'volunteer' | 'owner_fallback';

/**
 * Appoint an organiser to a quiet plan that has none.
 *
 * Only after the threshold: the table has `accept_organiser` on `collecting`
 * and `ready` and not on `seeking`, because the role is offered to a plan that
 * people are known to want. Only while nobody holds it (`no_organiser_yet`);
 * the first to accept wins, and the compare-and-set that makes "first" true
 * under concurrency is the database's.
 *
 * The owner's fallback waits for the response deadline. The table's
 * `keen_initiator_or_owner` guard lets the owner in at any time — it has to,
 * or the nudge would lead nowhere — and the wait is this rule's: before replies
 * close, the role belongs to the people who said they were keen. An owner who
 * is keen needs no fallback and volunteers like anybody else.
 *
 * No dead end: from `collecting` and `ready` somebody can always take the
 * role — the initiator is keen and permanent by construction — and once they
 * have, `confirm` is open to them.
 */
export function acceptOrganiser(
  plan: Plan,
  actor: Actor,
  source: OrganiserSource,
  now: Instant,
): Result<QuietError, Plan> {
  if (plan.mode !== 'quiet') return refuse('not_quiet');

  switch (source) {
    case 'initiator':
      if (actor.isInitiator !== true) {
        return err({ code: 'not_the_initiator', action: 'accept_organiser', from: plan.state });
      }
      break;
    case 'volunteer':
      if (actor.isKeen !== true) return refuse('not_keen');
      break;
    case 'owner_fallback':
      if (!actor.isOwner) return refuse('not_the_owner');
      if (isBefore(now, plan.responseDeadline)) return refuse('deadline_not_passed');
      break;
  }

  return canTransition(plan, 'accept_organiser', { actor });
}

/**
 * Close an ask that reached its stop time without opening (spec §5.4.7):
 * `expired`, privately. Nobody is told but the initiator, and they are told
 * only that it closed (`quietView`).
 *
 * "Without opening" rather than "below threshold": an ask held at its threshold
 * beside an open plan (ADR 0035) that is still held at its stop time closes
 * here too, and is indistinguishable from one that was not.
 *
 * Only from `seeking`. A quiet plan that has opened expires by the rule every
 * plan does, when its last possible start passes; that is `canTransition`'s
 * row, not this.
 */
export function expire(plan: Plan, now: Instant): Result<QuietError, Plan> {
  if (plan.mode !== 'quiet') return refuse('not_quiet');
  if (plan.state !== 'seeking')
    return err({ code: 'wrong_state', action: 'expire', from: plan.state });
  if (plan.quietExpiresAt === undefined) return refuse('no_stop_time');
  if (isBefore(now, plan.quietExpiresAt)) return refuse('stop_time_not_reached');
  return canTransition(plan, 'expire', { actor: NOBODY });
}

/**
 * The initiator calls it off before the threshold (spec §9): closed privately,
 * nobody told.
 *
 * The table's `seeking → cancel` row, guarded `member` + `initiator`
 * (SUS-24). The ticket described it as `expired` with a `withdrawn` flag;
 * `cancelled` is what the table already says, a flag on the plan row would be
 * readable by the whole circle either way, and `quietView` shows a withdrawn
 * ask and an expired one identically to everybody but the initiator.
 *
 * Only from `seeking`. After the threshold the plan belongs to the circle, and
 * cancelling it is the organiser's or the owner's (§4.5) — never the
 * initiator's *as* initiator, which would be a button that names them.
 */
export function withdraw(plan: Plan, actor: Actor): Result<QuietError, Plan> {
  if (plan.mode !== 'quiet') return refuse('not_quiet');
  if (plan.state !== 'seeking') {
    return err({ code: 'wrong_state', action: 'cancel', from: plan.state });
  }
  return canTransition(plan, 'cancel', { actor });
}
