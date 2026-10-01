import type { CircleId, PlanId } from '@circles/contracts';

import { track } from '../../analytics/track';
import { appOrigin } from '../../data/links/origin';
import { planLink } from '../../data/planning';
import type { PlanCandidates } from '../../data/scheduling';
import { shareMessage } from '../../platform/share';
import { reminderMessage } from '../planning/reminder';
import { notAnswered } from './view';

/**
 * Hands the plan's link to the group chat again, as the count-only reminder
 * (SUS-132). The organiser's screens and a member's both send it, so what it
 * says and what it tracks is worked out once.
 *
 * How many replies are still out comes from the summaries the reader may see
 * rather than from the set's own count — that belongs to the set, and a set
 * one answer behind would have a message saying so. A member does not see who
 * has answered (`responded` is null), so they fall back to the plan's counts.
 */
export function shareReminder(data: PlanCandidates): void {
  const remaining =
    data.responded === null
      ? Math.max(0, data.askedCount - data.repliedCount)
      : notAnswered(data).length;
  const message = reminderMessage({
    remaining,
    circleName: data.circleName,
    url: planLink(appOrigin(), data.code),
  });
  void shareMessage(message).then((result) => {
    if (result === 'sheet' || result === 'dismissed' || result === 'copied') {
      track('share_opened', {
        circle_id: data.circleId as CircleId,
        plan_id: data.planId as PlanId,
        kind: 'reminder',
      });
    }
  });
}
