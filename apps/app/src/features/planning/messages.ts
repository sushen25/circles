import { DEEP_LINK_ROUTES } from '@circles/contracts';
import { EN_SHARE_TEMPLATES } from '@circles/domain';

import type { PlanDetails } from '../../data/planning';
import { weekdayOf } from '../scheduling/words';

/**
 * Which day is off, and the paste-ready updates that say so (spec §5.7, §5.8).
 * The sentences are the domain's (`EN_SHARE_TEMPLATES`), never composed here.
 */

/**
 * The day a reopen took off the table: the confirmation the plan's previous
 * revision was locked in with, now superseded. Nothing for a plan that was
 * never locked in, or has been locked in again since.
 */
export function reopenedDay(plan: PlanDetails): string | undefined {
  const last = plan.lastConfirmation;
  if (last === null || last.status !== 'superseded') return undefined;
  if (last.revision !== plan.revision - 1) return undefined;
  if (plan.state !== 'collecting' && plan.state !== 'ready') return undefined;
  return weekdayOf(last.startsAt, plan.zone);
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
