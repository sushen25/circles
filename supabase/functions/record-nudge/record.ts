import type { RecordNudgeRequest, RecordNudgeResponse } from '@circles/contracts';
import {
  type IdentityTier,
  type Instant,
  isPlanBoundMoment,
  nudgeEligibility,
  nudgeGroupOf,
} from '@circles/domain';

import { Refusal } from '../_shared/problem.ts';
import type { NudgeStore } from './store.ts';

/**
 * The decision, apart from HTTP (spec §5.11).
 *
 * A question — may this be shown? — is answered by `nudgeEligibility` over the
 * caller's whole history, and a yes is recorded as shown before it is given,
 * so the answer and the record cannot disagree. An answer is recorded as it
 * comes: the prompt was on screen.
 */
export async function recordNudge(
  store: NudgeStore,
  body: RecordNudgeRequest,
  tier: IdentityTier,
  now: Instant,
): Promise<RecordNudgeResponse> {
  const planId = isPlanBoundMoment(body.moment) ? (body.plan_id ?? null) : null;

  // Refused before anything is read, and as the reason a client can act on.
  // RLS would refuse the write anyway, with a 42501 no screen can tell apart
  // from every other permission problem.
  if (planId !== null && !(await store.planVisible(planId))) {
    throw new Refusal('not_a_member', 'That plan is not in one of your circles.');
  }

  if (body.answer !== undefined) {
    await store.recordAnswer(body.moment, planId, body.answer);
    return { suppressed: false };
  }

  const facts =
    body.moment === 'after_attendance_start_circle' && planId !== null
      ? await store.afterAttendance(planId)
      : undefined;

  const decision = nudgeEligibility(body.moment, await store.history(), tier, now, {
    planId: planId ?? undefined,
    // The session is the client's to know; the server has no sessions. What
    // the server adds is every other device's history.
    ...(body.moment === 'after_attendance_start_circle'
      ? { attendedFirstInCircle: facts !== undefined && facts.attended && facts.firstInCircle }
      : {}),
  });
  if (decision.kind === 'skip') return { suppressed: true, reason: decision.reason };

  const recorded = await store.recordShown(body.moment, planId);
  // The gate has one row per person, and a guest meets it every time they try
  // to organise: the first meeting is the record, and the rest are the gate.
  if (recorded || nudgeGroupOf(body.moment) === 'gate') return { suppressed: false };
  // Somebody else's request recorded it between the read and the write.
  return { suppressed: true, reason: 'already_shown' };
}
