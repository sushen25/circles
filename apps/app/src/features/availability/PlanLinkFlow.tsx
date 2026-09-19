import type { ShortCode } from '@circles/contracts';
import { ANSWERABLE_STATES } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { hasBackend } from '../../data/auth/client';
import { useSession } from '../../data/auth/session';
import { planToAnswer } from '../../data/availability';
import { AvailabilityFlow } from './AvailabilityFlow';

/**
 * `/p/:code` — the link the group chat has — for a member (S1-25, item 1).
 *
 * Somebody who has not answered a plan that is still asking is there to answer
 * it, so they get the editor, not a candidates screen with nothing of theirs in
 * it. Everybody else gets what the plan page shows (`children`). The same read
 * as `/j/:code`'s, under the same key, so moving between them fetches once.
 */
export function PlanLinkFlow({ code, children }: { code: string; children: ReactNode }) {
  if (!hasBackend()) return <>{children}</>;
  return <LivePlanLink code={code}>{children}</LivePlanLink>;
}

function LivePlanLink({ code, children }: { code: string; children: ReactNode }) {
  const session = useSession();
  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: session.userId !== undefined,
    staleTime: 30_000,
  });

  const unanswered =
    question.data !== undefined &&
    question.data !== null &&
    question.data.answer === null &&
    ANSWERABLE_STATES.includes(question.data.plan.state);

  // Until the read lands — or when it fails — the editor: it has its own
  // loading, error and offline states, and a draft on this device to show.
  if (question.data === undefined || unanswered) {
    return <AvailabilityFlow code={code} step="times" />;
  }
  return <>{children}</>;
}
