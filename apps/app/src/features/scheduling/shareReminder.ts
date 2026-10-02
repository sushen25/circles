import type { CircleId, PlanId } from '@circles/contracts';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { appOrigin } from '../../data/links/origin';
import { planLink } from '../../data/planning';
import type { PlanCandidates } from '../../data/scheduling';
import { shareMessage } from '../../platform/share';
import { reminderMessage } from '../planning/reminder';
import { notAnswered } from './view';

/**
 * Hands the plan's link to the group chat again, as the count-only reminder
 * (SUS-132), and says what happened when it copied rather than opened a
 * sheet. The organiser's screens and a member's all send it, so what it says,
 * what it tracks and who may do it is worked out once.
 *
 * How many replies are still out comes from the summaries the reader may see
 * rather than from the set's own count — that belongs to the set, and a set
 * one answer behind would have a message saying so. A member does not see who
 * has answered (`responded` is null), so they fall back to the plan's counts.
 *
 * `share` is undefined when the reader should not be offered it: replies have
 * closed (`replace_response` refuses an answer, so the link leads nowhere), or
 * a quiet ask nobody has taken on, which stays anonymous (spec §5.4) and has
 * no organiser to be anonymous about.
 */
export function useShareReminder(data: PlanCandidates | undefined): {
  share: (() => void) | undefined;
  outcome: string | undefined;
} {
  const [outcome, setOutcome] = useState<string | undefined>();
  if (data === undefined || !data.repliesOpen || data.organiserUserId === null) {
    return { share: undefined, outcome: undefined };
  }
  const share = () => {
    setOutcome(undefined);
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
      if (result === 'copied') setOutcome(t('waiting', 'link_copied'));
      else if (result === 'failed') setOutcome(t('waiting', 'link_couldnt_copy'));
    });
  };
  return { share, outcome };
}
