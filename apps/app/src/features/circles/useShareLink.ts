import type { CircleId, PlanId } from '@circles/contracts';
import { fromISO, isAfter } from '@circles/domain';
import { useEffect, useState } from 'react';

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
 * ask nobody has taken on has its own screens and its own anonymity (spec
 * §5.4), so it is not offered here; once somebody has, it is a plan like any.
 */
export function useShareLink(home: CircleHome): {
  onShareLink: (() => void) | undefined;
  outcome: string | undefined;
} {
  const [outcome, setOutcome] = useState<string | undefined>();
  // A home left open across the deadline is not read again while a plan is
  // running, so the deadline itself has to re-draw it. A timer cannot run
  // longer than about 24 days; a plan's window is shorter.
  const [now, setNow] = useState(() => new Date());
  const plan = home.activePlan;
  const deadline = plan === null ? undefined : Date.parse(plan.responseDeadline);
  useEffect(() => {
    if (deadline === undefined) return;
    const wait = deadline - Date.now();
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => setNow(new Date()), wait + 50);
    return () => clearTimeout(timer);
  }, [deadline]);
  const open =
    plan !== null &&
    !(plan.quiet === true && plan.organiserUserId === null) &&
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
