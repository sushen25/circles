import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { stretchOf } from '../../data/confirmation';

/**
 * Who a stretch works for, kept current while the screen is open (ADR 0050).
 *
 * Asked of the database each time the stretch changes, and again every fifteen
 * seconds and on every return to the screen: people answer from the group chat
 * while the organiser looks, and the names on screen are the names a lock-in
 * will be held to (`stale_availability`). The last answer stays on screen while
 * the next is on its way, so the names do not blink out as the time is stepped.
 */
export const STRETCH_POLL_MS = 15_000;

/** How long the time may sit still before it is asked about. */
export const SETTLE_MS = 200;

export function useStretch(
  planId: string,
  range: { startsAt: string; endsAt: string } | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['stretch', planId, range?.startsAt, range?.endsAt],
    queryFn: () => stretchOf(planId, range?.startsAt ?? '', range?.endsAt ?? ''),
    enabled: enabled && range !== undefined,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchInterval: STRETCH_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** A value that follows another after it has held still for a moment. */
export function useSettled<T>(value: T, ms = SETTLE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
