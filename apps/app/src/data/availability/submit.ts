import { SubmitAvailabilityResponse, type IdempotencyKey } from '@circles/contracts';
import type { ResponseStatus } from '@circles/domain';

import { invokeFunction } from '../functions';
import type { Span } from './plan';

/**
 * `submit-availability`: one answer to one revision (spec §5.5, S1-16).
 *
 * The revision is the one the person was **shown**, not the one last fetched. A
 * draft that waited out a dead connection comes back addressed to the question
 * it answered; if the organiser has moved the plan on since, the server says
 * `stale_revision` and the editor asks again, rather than this storing
 * yesterday's times against today's dates.
 */
export interface SubmitAnswerOptions {
  planId: string;
  revision: number;
  status: ResponseStatus;
  /** Only for `windows`; every other answer carries none. */
  windows: readonly Span[];
  /** One per answer: a resend of the same answer reuses it (ADR 0016). */
  idempotencyKey: IdempotencyKey;
}

export async function submitAnswer({
  planId,
  revision,
  status,
  windows,
  idempotencyKey,
}: SubmitAnswerOptions): Promise<SubmitAvailabilityResponse> {
  return await invokeFunction(
    'submit-availability',
    {
      idempotency_key: idempotencyKey,
      plan_id: planId,
      revision,
      status,
      windows: status === 'windows' ? windows : [],
      used_calendar_overlay: false,
    },
    SubmitAvailabilityResponse,
  );
}
