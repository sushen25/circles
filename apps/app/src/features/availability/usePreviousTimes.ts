import type { PlanId } from '@circles/contracts';
import type { DayPart } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { usualTimes } from '../../data/availability';

/**
 * Previous times (ADR 0005, ADR 0037's amendment, SUS-159, ADR 0068): what this
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
  // Only this opening's read: what an earlier opening cached is never taken for
  // what the person has offered since (it would start an answer from stale
  // times), and a failed read offers nothing.
  const fresh = userId !== undefined && read.isFetchedAfterMount && !read.isError;
  return {
    parts: fresh ? read.data : undefined,
    used,
    /** The tap was used (true) or undone (false). */
    markUsed: (on = true) => markUsed(on),
    /** Answered or failed for this opening; with no backend, or no offer to make, there is nothing to wait for. */
    settled: userId === undefined || !enabled || read.isFetchedAfterMount,
  };
}

/**
 * `availability_started`, once per opening (§11.2's "median response after
 * link open"), with whether the offer was on show (the explicit "Use my usual
 * days" tap, ADR 0077). It waits for the read to settle so the flag is true or
 * false, but never for long: the start is never
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
  const latest = useRef({ active, planId, settled });
  useEffect(() => {
    latest.current = { active, planId, settled };
  });
  // Left before the read came back (a bounce): the start still counts, without
  // the flag. Only on leaving; a read that settles first sends its own.
  useEffect(
    () => () => {
      const now = latest.current;
      if (!now.active || now.settled || sent.current === now.planId) return;
      sent.current = now.planId;
      track('availability_started', { plan_id: now.planId as PlanId });
    },
    [],
  );
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
