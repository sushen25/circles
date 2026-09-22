import type { CircleId, PlanId } from '@circles/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { FunctionError } from '../../data/functions';
import { closeAttempt, lowerQuorum } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';

/**
 * The two resolutions the no-quorum screen can carry out (spec §5.6).
 *
 * **Lowering the quorum recalculates in the same request** — `revise-plan` runs
 * the engine after it saves (S1-16) — so the screen refetches once and is
 * already showing the options that number unlocked. Nothing polls for it.
 *
 * **Closing asks first.** It cannot be undone and everybody hears about it, so
 * it is the one action here with a confirm; the words in the sheet are the
 * words the circle will get.
 *
 * Refusals are read from `Problem.reason`, never the message (architecture
 * §9.1): a copy edit on the server must not be able to break a branch here.
 */
export type Resolution = {
  busy: 'lower' | 'close' | undefined;
  confirming: boolean;
  problem: string | undefined;
  lower: (quorum: number) => void;
  askToClose: () => void;
  keepOpen: () => void;
  close: () => void;
};

function problemOf(error: unknown): string {
  if (isOffline()) return t('noQuorum', 'youre_offline');
  if (!(error instanceof FunctionError)) return t('noQuorum', 'problem_generic');
  switch (error.reason) {
    case 'not_the_organiser':
    case 'not_the_organiser_or_owner':
      return t('noQuorum', 'problem_not_organiser');
    case 'plan_is_finished':
    case 'wrong_state':
      return t('noQuorum', 'problem_finished');
    case 'nothing_to_change':
      return t('noQuorum', 'problem_nothing');
    default:
      return t('noQuorum', 'problem_generic');
  }
}

export function useResolution({
  planId,
  circleId,
}: {
  planId: string;
  circleId: string;
}): Resolution {
  const router = useRouter();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string>();

  const ids = { circle_id: circleId as CircleId, plan_id: planId as PlanId };
  const again = () => client.invalidateQueries({ queryKey: ['plan-candidates', planId] });

  const lowering = useMutation({
    mutationFn: (quorum: number) => lowerQuorum(planId, quorum),
    onSuccess: () => {
      // A quorum change moves what is eligible, not what anybody was asked, so
      // it costs nobody a second reply (`revise-plan`'s `invalidatingChanges`).
      track('plan_edited', { ...ids, invalidated_responses: false });
      setProblem(undefined);
      void again();
    },
    onError: (error) => setProblem(problemOf(error)),
  });

  const closing = useMutation({
    mutationFn: () => closeAttempt(planId),
    onSuccess: () => {
      track('plan_cancelled', ids);
      setConfirming(false);
      void again();
      router.dismissTo({ pathname: '/circles/[id]', params: { id: circleId } });
    },
    onError: (error) => setProblem(problemOf(error)),
  });

  return {
    busy: lowering.isPending ? 'lower' : closing.isPending ? 'close' : undefined,
    confirming,
    problem,
    lower: (quorum) => {
      setProblem(undefined);
      lowering.mutate(quorum);
    },
    askToClose: () => {
      setProblem(undefined);
      setConfirming(true);
    },
    keepOpen: () => setConfirming(false),
    close: () => {
      setProblem(undefined);
      closing.mutate();
    },
  };
}
