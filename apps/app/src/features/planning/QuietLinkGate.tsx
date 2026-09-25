import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { planByCode } from '../../data/planning';
import { QuietPlanFlow } from './QuietPlanFlow';
import { PlanStateScreen } from './states';

/**
 * `/p/:code` for a quiet ask nobody organises (spec §5.4): the quiet screens,
 * not the plan page. The initiator's "enough people are keen" letter links
 * here, and so does anything else that holds the plan's code.
 *
 * While nobody has taken the role the plan page has nobody to send a decision
 * to, and a withdrawn ask has nobody to say cancelled it; both are the quiet
 * flow's to draw. Once somebody organises it, the plan is a plan like any
 * other, and the link is the plan page again (`children`).
 */
export function QuietLinkGate({ code, children }: { code: string; children: ReactNode }) {
  if (!hasBackend()) return <>{children}</>;
  return <LiveQuietLinkGate code={code}>{children}</LiveQuietLinkGate>;
}

function LiveQuietLinkGate({ code, children }: { code: string; children: ReactNode }) {
  const session = useSession();
  const plan = useQuery({
    queryKey: ['plan-by-code', code, session.userId],
    queryFn: () => planByCode(code),
    enabled: session.userId !== undefined,
    staleTime: 0,
  });

  if (plan.isPending) return <PlanStateScreen state="loading" />;
  // Unread, or not a plan this reader may see: the plan page has its own
  // states for both.
  const data = plan.data ?? null;
  if (data === null || data.mode !== 'quiet' || data.organiserUserId !== null) {
    return <>{children}</>;
  }
  return <QuietPlanFlow planId={data.id} circleId={data.circleId} />;
}
