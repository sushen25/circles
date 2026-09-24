import type { PlanDetails } from '../../data/planning';
import { reopenedDay } from './messages';

/**
 * Where the plan's own link should put somebody once the plan has changed
 * under them (spec §5.7): a cancelled plan has its own screen, and a plan
 * reopened by "Change the time" says "Thursday is off the table" before it
 * asks again. `undefined` means the link's ordinary screen is the right one.
 *
 * The organiser (and, for a cancelled plan, the owner who may have cancelled
 * it) is sent to their own screen rather than the member's.
 */
export type Door =
  | { pathname: '/circles/[id]/plan/[planId]/cancelled'; params: { id: string; planId: string } }
  | { pathname: '/p/[code]/cancelled'; params: { code: string } }
  | { pathname: '/p/[code]/rescheduled'; params: { code: string } };

export function doorFor(
  plan: PlanDetails,
  /** Whether this person has answered the plan's current question; undefined while unknown. */
  answered: boolean | undefined,
): Door | 'wait' | undefined {
  if (plan.state === 'cancelled') {
    return plan.isOrganiser || plan.isOwner
      ? {
          pathname: '/circles/[id]/plan/[planId]/cancelled',
          params: { id: plan.circleId, planId: plan.planId },
        }
      : { pathname: '/p/[code]/cancelled', params: { code: plan.code } };
  }
  if (plan.isOrganiser || reopenedDay(plan) === undefined || plan.deadlinePassed) return undefined;
  if (answered === undefined) return 'wait';
  return answered ? undefined : { pathname: '/p/[code]/rescheduled', params: { code: plan.code } };
}
