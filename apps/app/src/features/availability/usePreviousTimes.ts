import type { PlanId } from '@circles/contracts';
import type { DayPart } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { usualTimes } from '../../data/availability';

/**
 * "Use my previous times" (ADR 0005, ADR 0037's amendment, SUS-159): what this
 * person has offered before in the plan's circle, limited to the parts this
 * plan asks about, read from the database in one request. Read again each time
 * the editor opens, because an answer given to another plan since may be the
 * one that makes the offer. A failed read offers nothing rather than an
 * error: it is a shortcut.
 */
const START_WAITS_FOR_IT_MS = 1500;

export function usePreviousTimes(input: {
  planId: string;
  userId: string | undefined;
  enabled: boolean;
}) {
  const { planId, userId, enabled } = input;
  const read = useQuery({
    queryKey: ['previous-times', planId, userId],
    queryFn: async () => (await usualTimes(planId)) as readonly DayPart[],
    enabled: userId !== undefined && enabled,
    staleTime: 0,
  });
  // Whether the answer began from the tap, even if it was edited afterwards.
  const [used, markUsed] = useState(false);
  return {
    parts: read.data,
    used,
    markUsed: () => markUsed(true),
    /** Answered or failed for this opening; with no backend there is nothing to wait for. */
    settled: userId === undefined || read.isFetchedAfterMount,
  };
}

/**
 * `availability_started`, once per opening (§11.2's "median response after
 * link open"), with whether the offer was on show. It waits for the read to
 * settle so the flag is true or false, but never for long: the start is never
 * held back for an optional read (ADR 0045), so after a moment it is sent
 * without the flag, which says "unknown". A yes or no, never a day-part.
 */
export function useStartedEvent(input: {
  active: boolean;
  planId: string;
  settled: boolean;
  offered: boolean;
}) {
  const { active, planId, settled, offered } = input;
  const sent = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!active || sent.current === planId) return;
    const send = (flag: { usual_offered: boolean } | Record<string, never>) => {
      sent.current = planId;
      track('availability_started', { plan_id: planId as PlanId, ...flag });
    };
    if (settled) {
      send({ usual_offered: offered });
      return;
    }
    const timer = setTimeout(() => send({}), START_WAITS_FOR_IT_MS);
    return () => clearTimeout(timer);
  }, [active, planId, settled, offered]);
}
