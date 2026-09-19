import type { ShortCode } from '@circles/contracts';
import { ANSWERABLE_STATES } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { hasBackend } from '../../data/auth/client';
import { useSession } from '../../data/auth/session';
import { planToAnswer, readDraft } from '../../data/availability';
import { draftIsNewer } from './Answering';
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

  // Times of theirs waiting on this device — an edit made offline, a send that
  // never got an answer. The editor is where those go, so it is where the
  // link goes, even for somebody the server already has an answer from.
  const draft = useQuery({
    queryKey: ['answer-draft-waiting', code, session.userId],
    // `null`, not `undefined`: a query may not resolve to nothing.
    queryFn: async () => (await readDraft(session.userId as string, code)) ?? null,
    enabled: session.userId !== undefined,
    staleTime: 0,
    gcTime: 0,
  });

  // Not a draft the server has since overtaken — an answer given later on
  // another device — which would otherwise send the link to the editor forever.
  const waiting =
    draft.data === undefined ||
    (draft.data !== null &&
      (draft.data.pending !== undefined ||
        question.data == null ||
        draftIsNewer(draft.data, question.data.answer)));

  const unanswered =
    question.data !== undefined &&
    question.data !== null &&
    question.data.answer === null &&
    ANSWERABLE_STATES.includes(question.data.plan.state);

  // Until both reads land — or when one fails — the editor: it has its own
  // loading, error and offline states, and a draft on this device to show.
  if (question.data === undefined || waiting || unanswered) {
    return <AvailabilityFlow code={code} step="times" />;
  }
  return <>{children}</>;
}
