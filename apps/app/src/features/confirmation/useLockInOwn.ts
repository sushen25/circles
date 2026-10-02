import type { CircleId, PlanId } from '@circles/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { confirmOwnTime, stretchOf, type ChasedAnswer } from '../../data/confirmation';
import { FunctionError } from '../../data/functions';
import { isOffline } from '../identity/join/failure';

/**
 * Locking in a time of the organiser's own (ADR 0050), and every way that can be
 * refused.
 *
 * **Checked twice, for two windows**, as `useLockIn` does for an option: who the
 * time works for is read again at the tap, and nothing is sent if an answer has
 * landed since the names on screen; then `expected_input_version` closes the
 * window between that read and the server's lock. Either ends the same way: read
 * again and show it, and never resend under the newer version — the organiser is
 * deciding about the names they saw.
 *
 * Refusals are read from `Problem.reason`, never the message.
 */

/** The names moved between the render and the tap. Not a server refusal. */
class NamesMoved extends Error {}

export type LockInOwnInput = {
  circleId: string;
  startsAt: string;
  endsAt: string;
  /** The plan's input version as the names on screen were read. */
  expectedInputVersion: number;
  invitedCount: number;
  belowQuorum: boolean;
  chasedAnswer: ChasedAnswer;
  placeName: string | undefined;
  placeUrl: string | undefined;
  note: string | undefined;
};

export type LockInOwn = {
  busy: boolean;
  problem: string | undefined;
  /** The plan is already locked in: the confirmed screen is where to be. */
  already: boolean;
  /** An answer landed since the names on screen: they are being read again. */
  moved: boolean;
  lockIn: (input: LockInOwnInput) => void;
};

function problemOf(error: unknown): { problem: string; already?: boolean; moved?: boolean } {
  if (isOffline()) return { problem: t('confirmReview', 'youre_offline') };
  if (error instanceof NamesMoved) return { problem: t('confirmReview', 'own_moved'), moved: true };
  if (!(error instanceof FunctionError)) return { problem: t('confirmReview', 'problem_generic') };
  switch (error.reason) {
    case 'stale_availability':
      return { problem: t('confirmReview', 'own_moved'), moved: true };
    case 'own_time_in_the_past':
      return { problem: t('confirmReview', 'passed') };
    case 'needs_own_time':
    case 'own_time_off_the_half_hour':
    case 'own_time_ends_before_it_starts':
    case 'own_time_too_short':
    case 'own_time_too_long':
    case 'own_time_too_far_ahead':
      return { problem: t('confirmReview', 'own_gone_title') };
    case 'not_the_organiser':
      return { problem: t('confirmReview', 'not_organiser_title') };
    case 'plan_not_found':
      return { problem: t('candidates', 'denied_title') };
    case 'wrong_state':
    case 'plan_is_finished':
      return { problem: t('confirmReview', 'already'), already: true };
    default:
      return error.reference === undefined
        ? { problem: t('confirmReview', 'problem_generic') }
        : { problem: t('confirmReview', 'problem_reference', { reference: error.reference }) };
  }
}

export function useLockInOwn({
  planId,
  onLocked,
}: {
  planId: string;
  onLocked: (circleId: string) => void;
}): LockInOwn {
  const client = useQueryClient();
  const [problem, setProblem] = useState<string>();
  const [already, setAlready] = useState(false);
  const [moved, setMoved] = useState(false);
  const again = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['plan-candidates', planId] }),
      client.invalidateQueries({ queryKey: ['stretch', planId] }),
    ]);

  const locking = useMutation({
    mutationFn: async (input: LockInOwnInput) => {
      const now = await stretchOf(planId, input.startsAt, input.endsAt);
      if (now.inputVersion !== input.expectedInputVersion) throw new NamesMoved();
      return confirmOwnTime({
        planId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        expectedInputVersion: input.expectedInputVersion,
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
        own_time: true,
        below_quorum: input.belowQuorum,
      });
      track('organiser_chased', { ...ids, answer: input.chasedAnswer });
      setProblem(undefined);
      setMoved(false);
      void client.invalidateQueries();
      onLocked(input.circleId);
    },
    onError: (error) => {
      const read = problemOf(error);
      setProblem(read.problem);
      setMoved(read.moved === true);
      if (read.already === true) setAlready(true);
      void again();
    },
  });

  return {
    busy: locking.isPending,
    problem,
    already,
    moved,
    lockIn: (input) => {
      setProblem(undefined);
      locking.mutate(input);
    },
  };
}
