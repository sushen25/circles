import type { CircleId, PlanId } from '@circles/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { confirmMeetup, type ChasedAnswer } from '../../data/confirmation';
import { FunctionError } from '../../data/functions';
import { planCandidates } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';
import { candidateIn } from './review';

/**
 * Locking the time in (spec §5.7), and every way that can be refused.
 *
 * **Checked twice, for two different windows.** The plan is read again at the
 * tap, and nothing is sent if the set on screen is no longer the plan's
 * current one: the screen is as old as its last poll, and an answer landing in
 * between moves what "5 of 6 can make it" means. `expected_set_id` then closes
 * the window between this read and the server's lock, which no client read
 * can. Either refusal ends the same way — read again and show it, never resend
 * with the newer id — because the organiser is deciding about what they saw.
 *
 * Refusals are read from `Problem.reason`, never the message (architecture
 * §9.1).
 */

/** The options moved between the render and the tap. Not a server refusal. */
class OptionsMoved extends Error {}

export type LockInInput = {
  /**
   * The plan's circle **as the read has it**, never the route's: the URL's
   * segment is only a path, and a stale one would put the events and the
   * next screen against somebody else's circle.
   */
  circleId: string;
  candidateId: string;
  expectedSetId: string;
  invitedCount: number;
  chasedAnswer: ChasedAnswer;
  placeName: string | undefined;
  placeUrl: string | undefined;
  note: string | undefined;
};

export type LockIn = {
  busy: boolean;
  problem: string | undefined;
  /** The plan is already locked in: the confirmed screen is where to be. */
  already: boolean;
  lockIn: (input: LockInInput) => void;
};

function problemOf(error: unknown): { problem: string; already?: boolean } {
  if (isOffline()) return { problem: t('confirmReview', 'youre_offline') };
  if (error instanceof OptionsMoved) return { problem: t('confirmReview', 'moved') };
  if (!(error instanceof FunctionError)) return { problem: t('confirmReview', 'problem_generic') };
  switch (error.reason) {
    case 'stale_candidates':
      return { problem: t('confirmReview', 'moved') };
    case 'needs_candidate':
      return { problem: t('confirmReview', 'gone_title') };
    case 'candidate_has_passed':
      return { problem: t('confirmReview', 'passed') };
    case 'not_the_organiser':
      return { problem: t('confirmReview', 'not_organiser_title') };
    case 'plan_not_found':
      return { problem: t('candidates', 'denied_title') };
    case 'wrong_state':
      return { problem: t('confirmReview', 'already'), already: true };
    default:
      return error.reference === undefined
        ? { problem: t('confirmReview', 'problem_generic') }
        : { problem: t('confirmReview', 'problem_reference', { reference: error.reference }) };
  }
}

export function useLockIn({
  planId,
  onLocked,
}: {
  planId: string;
  onLocked: (circleId: string) => void;
}): LockIn {
  const client = useQueryClient();
  const [problem, setProblem] = useState<string>();
  const [already, setAlready] = useState(false);
  const again = () => client.invalidateQueries({ queryKey: ['plan-candidates', planId] });

  const locking = useMutation({
    mutationFn: async (input: LockInInput) => {
      const now = await planCandidates({ planId });
      if (
        now === null ||
        now.stale ||
        now.set?.id !== input.expectedSetId ||
        candidateIn(now, input.candidateId) === undefined
      ) {
        throw new OptionsMoved();
      }
      return confirmMeetup({
        planId,
        candidateId: input.candidateId,
        expectedSetId: input.expectedSetId,
        chasedAnswer: input.chasedAnswer,
        placeName: input.placeName,
        placeUrl: input.placeUrl,
        note: input.note,
      });
    },
    onSuccess: (confirmed, input) => {
      const ids = { circle_id: input.circleId as CircleId, plan_id: planId as PlanId };
      track('meetup_confirmed', {
        ...ids,
        attending_count: confirmed.going.length,
        invited_count: input.invitedCount,
      });
      track('organiser_chased', { ...ids, answer: input.chasedAnswer });
      setProblem(undefined);
      // Circle home, the options and the plan page all describe this plan, and
      // every one of them is now wrong.
      void client.invalidateQueries();
      onLocked(input.circleId);
    },
    onError: (error) => {
      const read = problemOf(error);
      setProblem(read.problem);
      if (read.already === true) setAlready(true);
      void again();
    },
  });

  return {
    busy: locking.isPending,
    problem,
    already,
    lockIn: (input) => {
      setProblem(undefined);
      locking.mutate(input);
    },
  };
}
