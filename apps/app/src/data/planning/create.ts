import {
  CreatePlanRequest,
  CreatePlanResponse,
  DEEP_LINK_ROUTES,
  type CircleId,
  type IdempotencyKey,
} from '@circles/contracts';

import { invokeFunction } from '../functions';

/**
 * `create-plan` with the first-run defaults accepted (spec §5.1 step 7, §5.3).
 *
 * The client sends what the person chose and nothing it did not: a preset, a
 * title, a category. Duration, quorum and deadline are left out, so the server
 * resolves them — the circle's defaults, and `max(2, ceil(n × 0.6))` over the
 * members **at the moment the plan is made** rather than when the screen was
 * opened. That is what "adjusts as more people join" means on FirstPlan: the
 * number on the card is a preview, and the one that counts is computed here.
 */
export interface CreateFirstPlanOptions {
  circleId: CircleId;
  title: string;
  idempotencyKey: IdempotencyKey;
}

export async function createFirstPlan(
  options: CreateFirstPlanOptions,
): Promise<CreatePlanResponse> {
  return await invokeFunction(
    'create-plan',
    {
      idempotency_key: options.idempotencyKey,
      circle_id: options.circleId,
      mode: 'named',
      title: options.title,
      category: 'catch_up',
      preset: 'next_14_days',
    },
    CreatePlanResponse,
  );
}

/**
 * `create-plan` from the full setup (spec §5.3, S1-26).
 *
 * **Only what the person changed is sent.** A field left at its default is
 * left out, so the server resolves it from the same rule the screen previewed
 * — and, for the quorum, keeps it *defaulted*: a quorum nobody chose follows
 * the plan's audience as people join (ADR 0026), and sending the number the
 * screen showed would have made it the organiser's for ever.
 */
export interface CreatePlanOptions {
  circleId: CircleId;
  title: string;
  category: CreatePlanRequest['category'];
  preset: CreatePlanRequest['preset'];
  custom?: { start: string; end: string } | undefined;
  daily?: { startMin: number; endMin: number } | undefined;
  durationMinutes?: number | undefined;
  quorum?: number | undefined;
  requiredMemberIds?: string[] | undefined;
  responseDeadline?: string | undefined;
  idempotencyKey: IdempotencyKey;
}

export async function createPlan(options: CreatePlanOptions): Promise<CreatePlanResponse> {
  const body: Record<string, unknown> = {
    idempotency_key: options.idempotencyKey,
    circle_id: options.circleId,
    mode: 'named',
    title: options.title,
    category: options.category,
    preset: options.preset,
  };
  if (options.custom !== undefined) body['custom'] = options.custom;
  if (options.daily !== undefined) body['daily'] = options.daily;
  if (options.durationMinutes !== undefined) body['duration_minutes'] = options.durationMinutes;
  if (options.quorum !== undefined) body['quorum'] = options.quorum;
  if (options.requiredMemberIds !== undefined) {
    body['required_member_ids'] = options.requiredMemberIds;
  }
  if (options.responseDeadline !== undefined) body['response_deadline'] = options.responseDeadline;
  return await invokeFunction('create-plan', CreatePlanRequest.parse(body), CreatePlanResponse);
}

/** `${origin}/j/<code>` — the plan's short link. Carries no secret (ADR 0022). */
export function planLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${DEEP_LINK_ROUTES.planInvite.replace(':code', code)}`;
}
