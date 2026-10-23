import type { ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { hasBackend } from '../../data/auth/client';
import { useSession } from '../../data/auth/session';
import { planToAnswer, readDraft } from '../../data/availability';
import { draftIsNewer } from './Answering';

/**
 * `/j/:code`, the chat link, for somebody who has already answered (SUS-250):
 * it opens on how things stand, as `/p/:code` does, with "Your times are in."
 * first. The editor is one tap on, from "Change my times", which says `edit`.
 *
 * Only while the plan is still asking and nothing of theirs is waiting on this
 * phone: a draft or a send that never got its reply is what the editor is for.
 * Once replies have closed the editor's own closed screen speaks, and it has
 * the way on to the options. Anybody who has not answered gets the editor.
 */
export function AnsweredGate({
  code,
  edit,
  children,
}: {
  code: string;
  /** Set by "Change my times" and by the organiser's way to their own answer. */
  edit: boolean;
  children: ReactNode;
}) {
  if (!hasBackend() || edit) return <>{children}</>;
  return <Live code={code}>{children}</Live>;
}

function Live({ code, children }: { code: string; children: ReactNode }) {
  const session = useSession();
  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: session.userId !== undefined,
    staleTime: 30_000,
  });
  const draft = useQuery({
    queryKey: ['answer-draft-waiting', code, session.userId],
    queryFn: async () => (await readDraft(session.userId as string, code)) ?? null,
    enabled: session.userId !== undefined,
    staleTime: 0,
    gcTime: 0,
  });

  // Until both reads land, or if one fails, the editor: it has the loading, error and offline states.
  if (question.data === undefined || question.data === null || draft.data === undefined) {
    return <>{children}</>;
  }
  const { answer, plan } = question.data;
  const answered =
    answer !== null &&
    plan.acceptingAnswers &&
    draft.data?.pending === undefined &&
    (draft.data === null || !draftIsNewer(draft.data, answer));
  if (!answered) return <>{children}</>;
  return <Redirect href={{ pathname: '/p/[code]', params: { code, arrived: '1' } }} />;
}
