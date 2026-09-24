import {
  type IdempotencyKey,
  CancelPlanRequest,
  CancelPlanResponse,
  RevisePlanRequest,
  RevisePlanResponse,
} from '@circles/contracts';

import { invokeFunction, newIdempotencyKey } from '../functions';

/**
 * Editing a plan, reopening a confirmed one and cancelling (spec §5.3, §5.7).
 *
 * **Preview, then save with the token.** §5.3 promises the organiser sees
 * exactly who will be asked again *before* saving, and a client cannot work
 * that out: a member reads only their own answer. So every save here is two
 * calls — `preview: true`, which answers the question and changes nothing, and
 * the save, which carries the `version` the preview came back with as
 * `expected_version`. An answer landing in between is refused as
 * `preview_is_stale` rather than quietly costing somebody more than they were
 * shown.
 *
 * The version guards every edit, not only an invalidating one: a quorum or a
 * required list is permanent too, and the no-quorum screen's round five found
 * a quorum committed against a plan that had moved (S1-27).
 *
 * **Only what was edited is sent.** The server refuses a request in which
 * nothing differs (`nothing_to_change`), and derives the cheap `adjust` or the
 * expensive `edit` from what actually differs (ADR 0017) — so the screen does
 * not choose, it reads `bumps_revision` from the answer.
 */
export type Revision = {
  window?: { start: string; end: string } | undefined;
  daily?: { startMin: number; endMin: number } | undefined;
  durationMinutes?: number | undefined;
  quorum?: number | undefined;
  requiredMemberIds?: string[] | undefined;
  responseDeadline?: string | undefined;
  /** "Change the time": unpick the confirmation and ask again (§5.7). */
  reopen?: boolean | undefined;
};

function bodyOf(
  planId: string,
  revision: Revision,
  key: IdempotencyKey = newIdempotencyKey(),
): Record<string, unknown> {
  const body: Record<string, unknown> = { idempotency_key: key, plan_id: planId };
  if (revision.window !== undefined) body['window'] = revision.window;
  if (revision.daily !== undefined) body['daily'] = revision.daily;
  if (revision.durationMinutes !== undefined) body['duration_minutes'] = revision.durationMinutes;
  if (revision.quorum !== undefined) body['quorum'] = revision.quorum;
  if (revision.requiredMemberIds !== undefined) {
    body['required_member_ids'] = revision.requiredMemberIds;
  }
  if (revision.responseDeadline !== undefined) {
    body['response_deadline'] = revision.responseDeadline;
  }
  if (revision.reopen === true) body['reopen'] = true;
  return body;
}

/** What saving this would cost, and the version it would cost it at. Changes nothing. */
export async function previewRevision(
  planId: string,
  revision: Revision,
): Promise<RevisePlanResponse> {
  return invokeFunction(
    'revise-plan',
    RevisePlanRequest.parse({ ...bodyOf(planId, revision), preview: true }),
    RevisePlanResponse,
  );
}

/**
 * Save exactly what was previewed, or be refused with `preview_is_stale`.
 *
 * `key` is the caller's, held for one tap: a retry after a timeout is the same
 * request and gets the first one's answer, rather than a second save refused
 * as stale for a change that did land (ADR 0016).
 */
export async function saveRevision(
  planId: string,
  revision: Revision,
  expectedVersion: string,
  key: IdempotencyKey,
): Promise<RevisePlanResponse> {
  return invokeFunction(
    'revise-plan',
    RevisePlanRequest.parse({
      ...bodyOf(planId, revision, key),
      expected_version: expectedVersion,
    }),
    RevisePlanResponse,
  );
}

/**
 * Cancel, with the organiser's note if they wrote one. The note is content: it
 * goes to the function and the notices and never to a log or an analytics
 * payload (non-negotiable 8). A blank one is sent as none.
 */
export async function cancelPlan(
  planId: string,
  note: string | undefined,
  key: IdempotencyKey,
): Promise<void> {
  const trimmed = note?.trim();
  await invokeFunction(
    'cancel-plan',
    CancelPlanRequest.parse({
      idempotency_key: key,
      plan_id: planId,
      ...(trimmed === undefined || trimmed === '' ? {} : { note: trimmed }),
    }),
    CancelPlanResponse,
  );
}
