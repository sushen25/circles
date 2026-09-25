import {
  AcceptOrganiserRequest,
  AcceptOrganiserResponse,
  AnswerInterestRequest,
  AnswerInterestResponse,
  CreatePlanRequest,
  CreatePlanResponse,
  QuietViewRequest,
  QuietViewResponse,
  type CircleId,
  type IdempotencyKey,
  type QuietView,
} from '@circles/contracts';
import type { StopTimeOption } from '@circles/domain';

import { authClient } from '../auth/client';
import { invokeFunction } from '../functions';

/**
 * The quiet ask, from the client's side (spec §5.4, S2-03).
 *
 * **What a quiet screen knows comes from `quiet-view` and nothing else.** The
 * server builds the view for whoever asks, from facts that stay in `private` —
 * who started it, who answered what — and returns capabilities: "you have
 * answered", "you may withdraw", "you may take the role". Nothing here reads
 * `private.*`, builds a viewer, or holds an initiator; there is nothing to
 * hold. The plan row read alongside is the public half of the plan, which any
 * member may read and which has no initiator column to read.
 */

export type { QuietView };

/** What this viewer may see of a quiet plan, or null for a named one or a non-member. */
export async function quietView(planId: string): Promise<QuietView | null> {
  const response = await invokeFunction(
    'quiet-view',
    QuietViewRequest.parse({ plan_id: planId }),
    QuietViewResponse,
  );
  return response.view;
}

export interface CreateQuietAskOptions {
  circleId: CircleId;
  title: string;
  category: CreatePlanRequest['category'];
  preset: Exclude<CreatePlanRequest['preset'], 'custom'>;
  stopTime: StopTimeOption;
  /** Only when chosen: the preset's own band is the server's default too. */
  daily?: { startMin: number; endMin: number } | undefined;
  durationMinutes?: number | undefined;
  idempotencyKey: IdempotencyKey;
}

/**
 * "Ask quietly" — `create-plan` with `mode: 'quiet'`. A preset and a stop-time
 * *option*, never an instant: the server resolves both, so the stop time is
 * always one the window offers. No quorum, no required members, no deadline —
 * a quiet ask has no organiser to choose them, and the contract refuses them.
 */
export async function createQuietAsk(options: CreateQuietAskOptions): Promise<CreatePlanResponse> {
  const body: Record<string, unknown> = {
    idempotency_key: options.idempotencyKey,
    circle_id: options.circleId,
    mode: 'quiet',
    title: options.title,
    category: options.category,
    preset: options.preset,
    stop_time: options.stopTime,
  };
  if (options.daily !== undefined) body['daily'] = options.daily;
  if (options.durationMinutes !== undefined) body['duration_minutes'] = options.durationMinutes;
  return await invokeFunction('create-plan', CreatePlanRequest.parse(body), CreatePlanResponse);
}

/**
 * **I'm keen** or **Not this time**. The answer says only that it was
 * recorded — not whether it opened the ask — so read `quiet-view` after it.
 *
 * `key` is one tap's: the answer is not part of the server's fingerprint, so
 * a changed answer sent under an old key would replay the first one.
 */
export async function answerInterest(
  planId: string,
  interested: boolean,
  key: IdempotencyKey,
): Promise<void> {
  await invokeFunction(
    'answer-interest',
    AnswerInterestRequest.parse({ idempotency_key: key, plan_id: planId, interested }),
    AnswerInterestResponse,
  );
}

/**
 * **I'll organise** / **I'll pick the time**. No role is sent: how the caller
 * comes to organise is the server's to work out and never to say.
 */
export async function acceptOrganiser(planId: string, key: IdempotencyKey): Promise<void> {
  await invokeFunction(
    'accept-organiser',
    AcceptOrganiserRequest.parse({ idempotency_key: key, plan_id: planId }),
    AcceptOrganiserResponse,
  );
}

/** The public half of a quiet plan: what any member of its circle may read. */
export type QuietPlan = {
  id: string;
  circleId: string;
  code: string;
  mode: 'named' | 'quiet';
  state: string;
  /** Null until somebody accepts the role (spec §5.4). A public fact from then on. */
  organiserUserId: string | null;
  /** Which of the four windows it asks about: "this weekend". */
  preset: 'tonight' | 'this_weekend' | 'next_7_days' | 'next_14_days' | null;
  zone: string;
  /** ISO. Once it opens, when replies close. */
  responseDeadline: string;
};

const PLAN_COLUMNS =
  'id, circle_id, short_code, mode, state, organiser_user_id, quiet_preset, time_zone, response_deadline';

type PlanRow = {
  id: string;
  circle_id: string;
  short_code: string;
  mode: string;
  state: string;
  organiser_user_id: string | null;
  quiet_preset: string | null;
  time_zone: string;
  response_deadline: string;
};

const PRESETS = ['tonight', 'this_weekend', 'next_7_days', 'next_14_days'] as const;

function planOf(row: PlanRow): QuietPlan {
  const preset = (PRESETS as readonly string[]).includes(row.quiet_preset ?? '')
    ? (row.quiet_preset as QuietPlan['preset'])
    : null;
  return {
    id: row.id,
    circleId: row.circle_id,
    code: row.short_code,
    mode: row.mode === 'quiet' ? 'quiet' : 'named',
    state: row.state,
    organiserUserId: row.organiser_user_id,
    preset,
    zone: row.time_zone,
    responseDeadline: row.response_deadline,
  };
}

/** Throws a fixed message: an exception is a thing that ends up in a log. */
const FAILED = 'quiet plan lookup failed';

/** A plan by id, through RLS as the member. Null when it is not theirs to see. */
export async function quietPlan(planId: string): Promise<QuietPlan | null> {
  const { data, error } = await authClient()
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('id', planId)
    .maybeSingle();
  if (error !== null) {
    if (error.code === '22P02') return null;
    throw new Error(FAILED);
  }
  return data === null ? null : planOf(data);
}

/** A plan by its short code — the `/p/:code` link — through RLS as the member. */
export async function planByCode(code: string): Promise<QuietPlan | null> {
  const { data, error } = await authClient()
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('short_code', code)
    .maybeSingle();
  if (error !== null) throw new Error(FAILED);
  return data === null ? null : planOf(data);
}
