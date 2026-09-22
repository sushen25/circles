import type { CircleId, PlanId } from '@circles/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { FunctionError } from '../../data/functions';
import { closeAttempt, lowerQuorum, previewWiderWindow, widenWindow } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';

/**
 * The three resolutions the no-quorum screen can carry out (spec §5.6).
 *
 * **Lowering the quorum recalculates in the same request** — `revise-plan` runs
 * the engine after it saves (S1-16) — so the screen refetches once and is
 * already showing the options that number unlocked. Nothing polls for it.
 *
 * **Two of them ask first, for opposite reasons.** Closing cannot be undone and
 * everybody hears about it, so the sheet says the words the circle will get.
 * Widening the window *moves the question*: the revision bumps and every answer
 * to the old one is cleared, and §5.3 says the organiser is shown exactly who
 * that costs **before** saving — so the sheet is filled from `revise-plan`'s own
 * preview, and the save carries the `expected_version` it came back with. An
 * answer arriving in between is refused rather than quietly costing somebody
 * more than they were shown.
 *
 * Refusals are read from `Problem.reason`, never the message (architecture
 * §9.1): a copy edit on the server must not be able to break a branch here.
 */
export type Asking = 'close' | 'wider' | undefined;

export type Resolution = {
  busy: 'lower' | 'close' | 'wider' | undefined;
  /** Which sheet is open. */
  asking: Asking;
  /** Who a wider window would cost a second answer, once the preview lands. */
  askedAgain: string[] | undefined;
  problem: string | undefined;
  lower: (quorum: number) => void;
  askToClose: () => void;
  askToWiden: (window: { start: string; end: string }) => void;
  keepAsItIs: () => void;
  close: () => void;
  widen: () => void;
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
    case 'preview_is_stale':
      return t('noQuorum', 'problem_stale');
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
  const [asking, setAsking] = useState<Asking>();
  const [problem, setProblem] = useState<string>();
  const [wider, setWider] = useState<{
    window: { start: string; end: string };
    version?: string;
    askedAgain?: string[];
  }>();

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
      setAsking(undefined);
      void again();
      router.dismissTo({ pathname: '/circles/[id]', params: { id: circleId } });
    },
    onError: (error) => setProblem(problemOf(error)),
  });

  const previewing = useMutation({
    mutationFn: (window: { start: string; end: string }) => previewWiderWindow(planId, window),
    onSuccess: (answer, window) => {
      setWider({ window, version: answer.version, askedAgain: answer.asked_again });
      setAsking('wider');
    },
    onError: (error) => {
      setAsking(undefined);
      setProblem(problemOf(error));
    },
  });

  const widening = useMutation({
    mutationFn: (ask: { window: { start: string; end: string }; version: string }) =>
      widenWindow(planId, ask.window, ask.version),
    onSuccess: () => {
      // The question moved, so every answer to the old one went with it.
      track('plan_edited', { ...ids, invalidated_responses: true });
      setAsking(undefined);
      setWider(undefined);
      void again();
    },
    // The sheet closes and the preview goes with it. A `Sheet` is a modal, so
    // a notice left behind it is neither seen nor announced — and the version
    // the save was refused for is exactly the version a second tap would send
    // again. Closing puts the refusal in front of the organiser and makes the
    // next tap take a fresh preview.
    onError: (error) => {
      setAsking(undefined);
      setWider(undefined);
      setProblem(problemOf(error));
      void again();
    },
  });

  return {
    busy: lowering.isPending
      ? 'lower'
      : closing.isPending
        ? 'close'
        : widening.isPending || previewing.isPending
          ? 'wider'
          : undefined,
    asking,
    askedAgain: wider?.askedAgain,
    problem,
    lower: (quorum) => {
      setProblem(undefined);
      lowering.mutate(quorum);
    },
    askToClose: () => {
      setProblem(undefined);
      setAsking('close');
    },
    askToWiden: (window) => {
      setProblem(undefined);
      setWider(undefined);
      previewing.mutate(window);
    },
    keepAsItIs: () => {
      setAsking(undefined);
      setWider(undefined);
    },
    close: () => {
      setProblem(undefined);
      closing.mutate();
    },
    widen: () => {
      if (wider?.version === undefined) return;
      setProblem(undefined);
      widening.mutate({ window: wider.window, version: wider.version });
    },
  };
}
