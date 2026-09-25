import type { CircleId, IdempotencyKey, PlanId } from '@circles/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { newIdempotencyKey } from '../../data/functions';
import { acceptOrganiser, answerInterest, cancelPlan } from '../../data/planning';
import { forgetAsked } from './quiet';
import { quietRefusalOf, type QuietRefused } from './quietProblems';

/**
 * The three things a quiet screen can send (spec §5.4), each followed by a
 * fresh read of `quiet-view` — never by anything the response said, because
 * none of them says anything but "done".
 *
 * - **Answer**: a new idempotency key per tap. The answer is not part of the
 *   server's fingerprint, so "keen" then "not this time" under one key would
 *   replay the first.
 * - **Take the role**: no role is sent. One key per attempt, kept across a
 *   retry that got no answer, so a dropped response is the same request.
 * - **Withdraw**: `cancel-plan` with no note (a note is refused on an ask).
 *   Not `plan_cancelled`: beside this person's id, "withdrew a quiet ask" is
 *   the initiator.
 */
export function useQuietActions({
  planId,
  circleId,
  circleName,
  onChanged,
}: {
  planId: string;
  circleId: string;
  circleName: string | undefined;
  /** Read the view (and the plan) again. */
  onChanged: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<QuietRefused | undefined>();
  const inFlight = useRef(false);
  const acceptKey = useRef<IdempotencyKey | undefined>(undefined);
  const withdrawKey = useRef<IdempotencyKey | undefined>(undefined);
  const ids = { circle_id: circleId as CircleId, plan_id: planId as PlanId };

  const run = async (send: () => Promise<void>, onKey?: () => void): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setRefused(undefined);
    try {
      await send();
      return true;
    } catch (error) {
      const answer = quietRefusalOf(error, { circleName });
      setRefused(answer);
      if (answer.conclusive) onKey?.();
      if (answer.reread) await onChanged().catch(() => undefined);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return {
    busy,
    problem: refused?.message,
    /** The server's word that a saved place is needed (a stale session). */
    needsSavedPlace: refused?.needsSavedPlace === true,
    clear: () => setRefused(undefined),

    answer: (interested: boolean) =>
      run(async () => {
        await answerInterest(planId, interested, newIdempotencyKey());
        // Against nobody, and with no answer in it (`UNATTRIBUTED_EVENTS`).
        track('quiet_interest_answered', ids);
        await onChanged();
      }),

    accept: () =>
      run(
        async () => {
          acceptKey.current ??= newIdempotencyKey();
          await acceptOrganiser(planId, acceptKey.current);
          acceptKey.current = undefined;
          forgetAsked(planId);
          // The organiser is public from here on; how they came to it is not
          // said (version 2 has no role).
          track('organiser_accepted', ids);
          await queryClient.invalidateQueries({ queryKey: ['circle-home', circleId] });
        },
        () => {
          acceptKey.current = undefined;
        },
      ),

    withdraw: () =>
      run(
        async () => {
          withdrawKey.current ??= newIdempotencyKey();
          await cancelPlan(planId, undefined, withdrawKey.current);
          withdrawKey.current = undefined;
          forgetAsked(planId);
          await queryClient.invalidateQueries({ queryKey: ['circle-home', circleId] });
        },
        () => {
          withdrawKey.current = undefined;
        },
      ),
  };
}
