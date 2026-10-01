import type { CircleId, PlanId } from '@circles/contracts';
import { fromISO, isAfter } from '@circles/domain';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import type { CircleHome } from '../../data/circles';
import { appOrigin } from '../../data/links/origin';
import { planLink } from '../../data/planning';
import { shareMessage } from '../../platform/share';
import { reminderMessage } from '../planning/reminder';

/**
 * "Share the link" on the finding-a-time card (SUS-132): the way back to the
 * plan's link once the organiser has left the share screen.
 *
 * **Offered to every member, not only the organiser** (the founder's decision,
 * 1 October 2026): the link admits people and is not a secret (ADR 0022), and
 * the message is the count-only reminder, so a member forwarding it gives
 * nothing away. Nothing limits how often one is sent.
 *
 * Offered while it is still taking answers, which is
 * until its deadline: `replace_response` refuses one after it, and a link that
 * can no longer be used to answer is not worth chasing anybody with. A quiet
 * ask has its own screens and its own anonymity (spec §5.4), so it is not
 * offered here.
 */
export function useShareLink(
  home: CircleHome,
  now: Date = new Date(),
): { onShareLink: (() => void) | undefined; outcome: string | undefined } {
  const [outcome, setOutcome] = useState<string | undefined>();
  const plan = home.activePlan;
  const open =
    plan !== null &&
    plan.quiet !== true &&
    isAfter(fromISO(plan.responseDeadline), fromISO(now.toISOString()));
  if (!open) return { onShareLink: undefined, outcome: undefined };

  const onShareLink = () => {
    setOutcome(undefined);
    const message = reminderMessage({
      remaining: Math.max(0, plan.asked - plan.replied),
      circleName: home.name,
      url: planLink(appOrigin(), plan.code),
    });
    void shareMessage(message).then((result) => {
      if (result === 'sheet' || result === 'dismissed' || result === 'copied') {
        track('share_opened', {
          circle_id: home.id as CircleId,
          plan_id: plan.id as PlanId,
          kind: 'reminder',
        });
      }
      if (result === 'copied') setOutcome(t('circleHome', 'link_copied'));
      else if (result === 'failed') setOutcome(t('circleHome', 'link_couldnt_copy'));
    });
  };
  return { onShareLink, outcome };
}
