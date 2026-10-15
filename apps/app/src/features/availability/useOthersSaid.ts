import type { PlanId } from '@circles/contracts';
import { othersShown, type OthersSaid } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { track } from '../../analytics/track';
import { othersSaid, type AnswerablePlan } from '../../data/availability';

/**
 * What the others have said, as counts (SUS-129, ADR 0045), for the tiles on
 * the day grid and the half hours. Read again each time the editor opens, and
 * never kept: not in the draft, not on the device. A failed or offline read
 * offers nothing — the editor is then exactly as it was — and the answer can
 * still be sent. With no backend, `fixtureOthers` is the gallery's scenario.
 *
 * Also says, once the read has settled, whether this opening showed counts
 * (`availability_others_read`), so the answer time and the "I'm easy" share can
 * be compared with and without them. Its own event, not a field on the start:
 * the start is never held back for an optional read (review round 2).
 */
export function useOthersSaid(input: {
  plan: AnswerablePlan;
  userId: string | undefined;
  step: 'times' | 'none';
  fixtureOthers: OthersSaid | undefined;
}): { said: OthersSaid | undefined; pending: boolean } {
  const { plan, userId, step, fixtureOthers } = input;
  const others = useQuery({
    queryKey: ['others-said', plan.id, plan.revision, userId],
    queryFn: async () => (await othersSaid(plan.id)) ?? null,
    enabled: userId !== undefined && plan.acceptingAnswers,
    // Once per opening, and only this opening's (review round 1): what an
    // earlier opening read is never shown while this one's read is on its way
    // or after it fails (`isFetchedAfterMount` below), is dropped once the
    // editor closes, and is not read again while the editor stays open.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const said =
    userId === undefined
      ? fixtureOthers
      : others.isFetchedAfterMount && !others.isError
        ? (others.data ?? undefined)
        : undefined;

  const settled = userId === undefined || others.isFetchedAfterMount;
  // The read is on its way: the screen holds room for the longer guidance line
  // until it is back (SUS-136), so the counts arriving do not move the grid.
  const pending = userId !== undefined && plan.acceptingAnswers && !others.isFetchedAfterMount;
  const shown = said !== undefined && othersShown(said);
  const reported = useRef(false);
  useEffect(() => {
    if (step !== 'times' || !plan.acceptingAnswers || !settled || reported.current) return;
    reported.current = true;
    track('availability_others_read', { plan_id: plan.id as PlanId, others_shown: shown });
  }, [step, plan.acceptingAnswers, settled, shown, plan.id]);

  return { said, pending };
}
