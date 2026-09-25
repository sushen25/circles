import type { NotificationKind, UserId } from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import type { PlanContext } from './context.ts';

/**
 * Whom the four quiet-ask kinds are for (S2-02). Opening the asks that were
 * held is `quiet-held.ts`.
 *
 * **The initiator and the keen members are read here, per kind, and nowhere
 * else.** `dispatch_context` is loaded for every plan every run and carries
 * neither (S1-20's note on this ticket); `dispatch_quiet_audience` answers for
 * one kind at a time, the ids go into `recipientsFor` for that one question,
 * and the context that carried them is dropped. They are never logged, never
 * put in a job row (a job is keyed on its recipient — which for the
 * initiator's own two letters is them, and is theirs), never returned.
 */

/** The kinds whose audience needs the initiator or the keen members. */
const QUIET_AUDIENCE: ReadonlySet<NotificationKind> = new Set([
  'quiet_ask',
  'threshold_initiator',
  'threshold_keen',
  'quiet_expired',
]);

export function needsQuietAudience(kind: NotificationKind): boolean {
  return QUIET_AUDIENCE.has(kind);
}

/** `context`, with the one kind's quiet facts in its eligibility. */
export async function withQuietAudience(
  service: Db,
  context: PlanContext,
  kind: NotificationKind,
): Promise<PlanContext> {
  const { data, error } = await service.rpc('dispatch_quiet_audience', {
    p_plan_id: context.planId,
    p_kind: kind,
  });
  if (error !== null) throw error;
  const row = (data ?? {}) as { initiator_user_id?: string | null; keen_user_ids?: string[] };
  const initiator = row.initiator_user_id ?? undefined;
  return {
    ...context,
    eligibility: {
      ...context.eligibility,
      ...(initiator === undefined ? {} : { quietInitiatorId: initiator as UserId }),
      keenMemberIds: (row.keen_user_ids ?? []) as UserId[],
    },
  };
}
