import { DEEP_LINK_ROUTES } from '@circles/contracts';
import { EN_SHARE_TEMPLATES } from '@circles/domain';

import type { PlanDetails } from '../../data/planning';
import { weekdayOf } from '../scheduling/words';

/**
 * Which day is off, and the paste-ready updates that say so (spec §5.7, §5.8).
 * The sentences are the domain's (`EN_SHARE_TEMPLATES`), never composed here.
 */

/**
 * The day a reopen took off the table, for as long as it stays off: the
 * newest confirmation the plan has had is superseded and nothing has been
 * locked in since. Later edits do not bring it back — somebody who returns
 * after the organiser has changed the dates twice still has not heard that
 * Thursday is off (spec §5.7).
 */
export function offTheTable(plan: PlanDetails): string | undefined {
  const last = plan.lastConfirmation;
  if (last === null || last.status !== 'superseded') return undefined;
  if (plan.state !== 'collecting' && plan.state !== 'ready') return undefined;
  return weekdayOf(last.startsAt, plan.zone);
}

/**
 * The same day, only when the revision the plan is on is the reopen itself:
 * what the organiser's "Change of plan" message says straight after Change
 * the time. A later edit is its own ask and gets its own message.
 */
export function justReopened(plan: PlanDetails): string | undefined {
  const day = offTheTable(plan);
  return day !== undefined && plan.lastConfirmation?.revision === plan.revision - 1
    ? day
    : undefined;
}

/**
 * The day a cancelled plan was on, if it was on one: its own revision's
 * confirmation, called off with it. A plan cancelled while it was still
 * asking was never on a day.
 */
export function cancelledDay(plan: PlanDetails): string | undefined {
  const last = plan.lastConfirmation;
  if (last === null || last.revision !== plan.revision) return undefined;
  if (last.status !== 'cancelled' && last.status !== 'active') return undefined;
  return weekdayOf(last.startsAt, plan.zone);
}

/** `${origin}/p/<code>` — the plan page. Carries no secret (ADR 0022). */
export function planPage(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${DEEP_LINK_ROUTES.plan.replace(':code', code)}`;
}

/** "Update: Thursday's Sunday Crew catch-up is off. <note> <link>" */
export function cancelledUpdate(plan: PlanDetails, origin: string): string {
  return EN_SHARE_TEMPLATES.cancelled({
    circleName: plan.circleName,
    weekday: cancelledDay(plan),
    note: plan.cancelNote,
    url: planPage(origin, plan.code),
  });
}

/**
 * Who called it off, when that can be known. Nothing records the actor, and
 * the owner may cancel a plan somebody else organises (spec §4.5) — so the
 * organiser is named only when they are also the owner, the one case where
 * nobody else could have.
 */
export function cancelledBy(plan: PlanDetails): string | undefined {
  if (plan.organiserUserId === null || plan.organiserUserId !== plan.ownerUserId) return undefined;
  return plan.roster.find((m) => m.userId === plan.organiserUserId)?.name;
}
