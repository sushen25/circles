import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { guard, useSession } from '../../data/auth';
import { readDraft } from '../../data/draft';
import { FinishDraftScreen, type FinishDraftProblem } from './FinishDraftScreen';
import { finishDraft, finishProblem, firstShare } from './finishDraft';

/**
 * `/circles/new/finish` — where the drafted circle and plan are made for an
 * organiser who was signed in already (ADR 0053, ADR 0090): "Make the link" on
 * the evenings screen lands here. An organiser who signs in at the gate makes
 * them inside the code step instead, with the same `finishDraft`.
 *
 * It calls `create-circle`, `create-plan` and the organiser's own answer, once
 * each, and clears the draft only after all three have answered. **Safe to run
 * twice**: the keys were made with the draft, so a reload in the middle, or a
 * tap on Try again after a timeout, returns what the first run made (ADR 0016).
 *
 * "How did you hear about {brand}?" is not asked here any more: it comes after
 * the share (ADR 0090, rule 6), as a card on the share's done state.
 *
 * Nothing here decides who may organise. A session that is not a saved place
 * goes back to the gate; the server's `requires_saved_place` is read the same
 * way.
 */
export function FinishDraftFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const decision = guard({ route: 'saved', session });

  const [circleName, setCircleName] = useState('');
  const [problem, setProblem] = useState<FinishDraftProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (decision.kind === 'wait' || running.current) return;
    running.current = true;
    setProblem(undefined);
    setReference(undefined);

    const run = async () => {
      const draft = await readDraft();
      if (draft === null) {
        router.replace('/circles/new');
        return;
      }
      setCircleName(draft.circleName);
      if (decision.kind !== 'allow') {
        router.replace('/circles/new/save');
        return;
      }
      const outcome = await finishDraft();
      if (outcome.kind === 'no_draft') router.replace('/circles/new');
      else if (outcome.kind === 'needs_name') router.replace('/name');
      else {
        void queryClient.invalidateQueries({
          queryKey: ['circle-home', outcome.finished.circleId],
        });
        router.replace(firstShare(outcome.finished));
      }
    };

    run()
      .catch((error: unknown) => {
        const said = finishProblem(error);
        if (said.kind === 'saved_place') {
          // The session stopped being a saved place underneath the screen.
          router.replace('/circles/new/save');
        } else {
          setProblem(said.problem);
          setReference(said.reference);
        }
      })
      .finally(() => {
        running.current = false;
      });
    // `attempt` is the Try again button: another run of the same effect. The router
    // and the query client are left out on purpose: a new identity for either must
    // not run the finish again, which makes nothing twice only because of the keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision.kind, attempt]);

  return (
    <FinishDraftScreen
      circleName={circleName}
      problem={problem}
      reference={reference}
      onRetry={() => setAttempt((count) => count + 1)}
      onChangeTime={() => router.replace('/circles/new/plan')}
      onBackToPlan={() => router.replace('/circles/new/plan')}
    />
  );
}
