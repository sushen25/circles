import {
  CancelPlanRequest,
  CancelPlanResponse,
  RevisePlanRequest,
  RevisePlanResponse,
} from '@circles/contracts';

import { invokeFunction, newIdempotencyKey } from '../functions';

/**
 * The three things the no-quorum screen can do about it (spec §5.6).
 *
 * Each is a mutation, so each carries an idempotency key (ADR 0016): a second
 * tap on a slow connection is the same request, not a second one.
 */

/**
 * Lower the quorum, which is how "Lower to N people" unlocks the closest time.
 *
 * `revise-plan` runs the engine after a save, so the set the screen refetches
 * afterwards is already the new one — no polling and no wait (S1-16). It also
 * writes `quorum_source = 'chosen'`, so from here on the number is the
 * organiser's and stops following the circle (ADR 0026); the copy on the action
 * says so, because it is not "lower it for now".
 */
export async function lowerQuorum(planId: string, quorum: number): Promise<void> {
  await invokeFunction(
    'revise-plan',
    RevisePlanRequest.parse({
      idempotency_key: newIdempotencyKey(),
      plan_id: planId,
      quorum,
    }),
    RevisePlanResponse,
  );
}

/**
 * Close the attempt. No note: the no-quorum ending is nobody's fault and has
 * nothing to explain — "the circle just sees it didn't line up" (§3.5).
 */
export async function closeAttempt(planId: string): Promise<void> {
  await invokeFunction(
    'cancel-plan',
    CancelPlanRequest.parse({ idempotency_key: newIdempotencyKey(), plan_id: planId }),
    CancelPlanResponse,
  );
}

/**
 * What asking about more days would cost, without asking about them.
 *
 * A wider window is an **invalidating** change: it moves the question, so the
 * revision bumps and every answer to the old one is cleared (`revise-plan`).
 * Spec §5.3 is explicit that the organiser sees who that costs **before**
 * saving, which is what `preview` is for — and the `version` it comes back with
 * is sent to the save, so an answer arriving in between is refused rather than
 * quietly costing somebody more than they were shown.
 */
export async function previewWiderWindow(
  planId: string,
  window: { start: string; end: string },
): Promise<RevisePlanResponse> {
  return invokeFunction(
    'revise-plan',
    RevisePlanRequest.parse({
      idempotency_key: newIdempotencyKey(),
      plan_id: planId,
      window,
      preview: true,
    }),
    RevisePlanResponse,
  );
}

/** Ask about more days, for exactly the preview the organiser was shown. */
export async function widenWindow(
  planId: string,
  window: { start: string; end: string },
  expectedVersion: string,
): Promise<void> {
  await invokeFunction(
    'revise-plan',
    RevisePlanRequest.parse({
      idempotency_key: newIdempotencyKey(),
      plan_id: planId,
      window,
      expected_version: expectedVersion,
    }),
    RevisePlanResponse,
  );
}
