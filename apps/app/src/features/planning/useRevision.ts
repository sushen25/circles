import type { CircleId, IdempotencyKey, PlanId, RevisePlanResponse } from '@circles/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { newIdempotencyKey } from '../../data/functions';
import { previewRevision, saveRevision, type Revision } from '../../data/planning';
import { refusalOf, type Refused } from './problems';

/**
 * Preview, then save with the token (spec §5.3, S1-15's contract).
 *
 * The preview runs by itself once the draft has been still for a moment, so
 * the warning is on the screen **before** Save is tapped, as the artboard
 * draws it — and Save stays unavailable until the preview on screen is the
 * preview of what would be sent. The save carries that preview's `version`,
 * so an answer arriving in between is refused (`preview_is_stale`) and the
 * preview is fetched again rather than the organiser paying a cost they were
 * not shown.
 *
 * The preview is keyed by the request itself: a draft that goes back to what
 * was previewed a moment ago finds the answer already there.
 */
export const SETTLE_MS = 400;

export type RevisionState = {
  /** The preview for exactly the revision being shown, once it is in. */
  preview: RevisePlanResponse | undefined;
  checking: boolean;
  busy: boolean;
  refused: Refused | undefined;
  save: () => void;
};

export function useRevision({
  planId,
  circleId,
  revision,
  enabled,
  onSaved,
  event = 'plan_edited',
}: {
  planId: string;
  circleId: string;
  /** Undefined when there is nothing to send: unchanged, or not resolvable. */
  revision: Revision | undefined;
  enabled: boolean;
  onSaved: (answer: RevisePlanResponse) => void;
  /** "Change the time" is `plan_rescheduled`, not an edit (spec §11.3). */
  event?: 'plan_edited' | 'plan_rescheduled' | undefined;
}): RevisionState {
  const client = useQueryClient();
  const wanted = revision === undefined ? undefined : JSON.stringify(revision);
  const [settled, setSettled] = useState(wanted);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(wanted), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [wanted]);

  const preview = useQuery({
    queryKey: ['plan-revision-preview', planId, settled],
    queryFn: () => previewRevision(planId, JSON.parse(settled!) as Revision),
    enabled: enabled && settled !== undefined && settled === wanted,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });

  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused>();
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);
  const inFlight = useRef(false);

  const current = settled === wanted && preview.data !== undefined ? preview.data : undefined;
  const previewRefusal = preview.isError ? refusalOf(preview.error) : undefined;

  const save = async () => {
    if (inFlight.current || current === undefined || wanted === undefined) return;
    inFlight.current = true;
    setBusy(true);
    setRefused(undefined);
    // One tap, one save: a retry of the same request gets the first answer.
    if (key.current?.for !== `${wanted}@${current.version}`) {
      key.current = { for: `${wanted}@${current.version}`, key: newIdempotencyKey() };
    }
    try {
      const answer = await saveRevision(
        planId,
        JSON.parse(wanted) as Revision,
        current.version,
        key.current.key,
      );
      const ids = { circle_id: circleId as CircleId, plan_id: planId as PlanId };
      if (event === 'plan_rescheduled') track('plan_rescheduled', ids);
      else track('plan_edited', { ...ids, invalidated_responses: answer.bumps_revision });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plan-details', planId] }),
        client.invalidateQueries({ queryKey: ['plan-candidates'] }),
        client.invalidateQueries({ queryKey: ['circle-home', circleId] }),
        client.invalidateQueries({ queryKey: ['plan-confirmation'] }),
      ]);
      onSaved(answer);
    } catch (error) {
      const answer = refusalOf(error);
      setRefused(answer);
      key.current = undefined;
      // Somebody answered since the preview: ask it again, so the warning
      // on the screen is the cost of the next tap.
      if (answer.stale) void preview.refetch();
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return {
    preview: current,
    checking: enabled && wanted !== undefined && current === undefined && !preview.isError,
    busy,
    refused: refused ?? previewRefusal,
    save: () => void save(),
  };
}
