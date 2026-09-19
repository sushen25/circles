import type { ShortCode } from '@circles/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { hasBackend } from '../../data/auth/client';
import { useSession } from '../../data/auth/session';
import { planToAnswer, readDraft, type Draft } from '../../data/availability';
import { answerable } from '../../data/fixtures';
import { isOffline } from '../identity/join/failure';
import { Answering, type AvailabilityStep } from './Answering';
import { AvailabilityScreen } from './AvailabilityScreen';

/**
 * Answering a plan: `/j/:code`, and `/j/:code/none` for "none of these dates"
 * (spec §5.5, S1-25).
 *
 * Behind `MembershipGate`, so whoever reaches it is a member; this does not ask
 * again. What it owns:
 *
 * - **Where the answer starts.** A draft on this device for the same question
 *   wins over the stored answer when it is newer, because it is what the person
 *   last did. A draft for an *older* question is discarded and said so — the
 *   organiser changed the plan, and those times were about dates that are no
 *   longer asked (the rescheduled state).
 * - **Keeping it.** Every change is written to the device as it happens, so a
 *   reload, a dead battery or a tunnel costs nothing (§10: edits "survive
 *   refresh").
 * - **Sending it.** One idempotency key per answer, reused by every resend of
 *   that answer and replaced when the answer changes (ADR 0016). No answer from
 *   the server means the times wait on the device and go by themselves when
 *   there is a chance; a refusal means a screen.
 *
 * With no backend configured it renders Sunday Crew's plan from fixtures, so
 * the gallery and the export stay clickable.
 */
export type { AvailabilityStep };

export type AvailabilityFlowProps = { code: string; step: AvailabilityStep };

export function AvailabilityFlow({ code, step }: AvailabilityFlowProps) {
  if (!hasBackend()) {
    return (
      <Answering
        code={code}
        step={step}
        plan={answerable.plan}
        answer={answerable.answer}
        draft={undefined}
        changed={false}
        userId={undefined}
        onStale={() => undefined}
      />
    );
  }
  return <LiveAvailability code={code} step={step} />;
}

function LiveAvailability({ code, step }: AvailabilityFlowProps) {
  const router = useRouter();
  const session = useSession();
  const userId = session.userId;
  const queryClient = useQueryClient();

  const question = useQuery({
    queryKey: ['plan-to-answer', code, userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: userId !== undefined,
    staleTime: 30_000,
  });

  // Read on every mount rather than cached: `/j/:code` stays mounted under
  // `/j/:code/none`, and a cached draft would be the one from before the
  // person painted anything.
  //
  // Held with whose and which plan's draft it is, and only used when that is
  // still who and what this page is for. The page can outlive either — the code
  // changes under a mounted route, or somebody signs out on a shared browser
  // and somebody else signs in — and until the next read lands, the last one
  // would otherwise be shown to, and resent as, the wrong person (round 5).
  const readFor = `${userId ?? ''}:${code}`;
  const [read, setRead] = useState<{ for: string; draft: Draft | undefined }>();
  const draft: Draft | undefined | 'reading' =
    read === undefined || read.for !== readFor ? 'reading' : read.draft;
  const setDraft = (next: Draft | undefined) => setRead({ for: readFor, draft: next });
  useEffect(() => {
    if (userId === undefined) return;
    let live = true;
    void readDraft(userId, code).then((found) => {
      if (live) setRead({ for: `${userId}:${code}`, draft: found });
    });
    return () => {
      live = false;
    };
  }, [userId, code]);

  /** The organiser changed the question while a draft of the old one waited. */
  const [changed, setChanged] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // The question changed under the answer, wherever the editor had it from:
  // drop the draft, say so, and fetch the question as it is now. Its new
  // revision is a new key, so the editor opens again on the new dates.
  const onStale = () => {
    setChanged(true);
    setDraft(undefined);
    void queryClient.invalidateQueries({ queryKey: ['plan-to-answer', code] });
  };

  if (session.isLoading || userId === undefined || draft === 'reading') {
    return <AvailabilityScreen state="loading" onBack={back} />;
  }

  // The question as the server has it, when it has answered. When it cannot
  // answer, the question as this device last saw it, with the person's times:
  // they can finish, and it goes when the connection is back. While it is still
  // answering, only a draft holding a send that never got its reply is shown
  // early — that one resumes whatever the server says (`draftIsNewer`). Any
  // other draft waits: the server may have a newer answer from another device,
  // and an editor opened from the draft would keep showing, and could resend,
  // the older one (round 3).
  //
  // Keyed apart from the server's editor, so that when the server does answer
  // the editor is opened again and decides again, rather than keeping what it
  // opened with.
  const fromDevice =
    draft !== undefined &&
    question.data === undefined &&
    (question.isError || draft.pending !== undefined);
  if (fromDevice) {
    return (
      <Answering
        key={`${userId}:${draft.plan.id}:${draft.plan.revision}:device`}
        code={code}
        step={step}
        plan={draft.plan}
        answer={null}
        draft={draft}
        changed={false}
        userId={userId}
        onStale={onStale}
      />
    );
  }

  if (question.isError || question.data === null) {
    return (
      <AvailabilityScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void question.refetch()}
        onBack={back}
      />
    );
  }

  if (question.isPending) return <AvailabilityScreen state="loading" onBack={back} />;

  const { plan, answer } = question.data;
  const stale =
    draft !== undefined && (draft.plan.id !== plan.id || draft.plan.revision !== plan.revision);

  return (
    <Answering
      // A new question is a new editor: nothing painted against the old dates
      // may carry over into the new grid.
      key={`${userId}:${plan.id}:${plan.revision}`}
      code={code}
      step={step}
      plan={plan}
      answer={answer}
      draft={stale ? undefined : draft}
      discardDraft={stale}
      changed={changed || stale}
      userId={userId}
      onStale={onStale}
    />
  );
}
