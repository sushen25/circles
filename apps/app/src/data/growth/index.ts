import {
  NUDGE_STATE_COLUMNS,
  RecordNudgeResponse,
  nudgeRecordOf,
  type IdempotencyKey,
  type PlanId,
  type RecordNudgeRequest,
} from '@circles/contracts';
import { fromISO, type Instant, type NudgeMoment, type NudgeRecord } from '@circles/domain';

import { authClient } from '../auth/client';
import { invokeFunction } from '../functions';

/**
 * The prompts' record, from the client's side (spec §5.11, S2-07).
 *
 * `askToShow` is the question `record-nudge` answers before a prompt appears;
 * a yes is already recorded as shown when it arrives. `recordAnswer` is the
 * tap or the "not now". The rules are the domain's, run on the server over
 * every device's history — so this file decides nothing.
 */

export interface NudgeTarget {
  moment: NudgeMoment;
  /** Every moment but `organiser_gate` is about a plan. */
  planId?: string | undefined;
}

function bodyOf(target: NudgeTarget, idempotencyKey: IdempotencyKey): RecordNudgeRequest {
  return {
    idempotency_key: idempotencyKey,
    moment: target.moment,
    ...(target.planId === undefined ? {} : { plan_id: target.planId as PlanId }),
  };
}

/** May this prompt be shown? `suppressed: true` is no, and nothing was recorded. */
export async function askToShow(
  target: NudgeTarget,
  idempotencyKey: IdempotencyKey,
): Promise<RecordNudgeResponse> {
  return await invokeFunction(
    'record-nudge',
    { ...bodyOf(target, idempotencyKey) },
    RecordNudgeResponse,
  );
}

/** What was done with a prompt that was shown. */
export async function recordAnswer(
  target: NudgeTarget,
  answer: 'dismissed' | 'tapped',
  idempotencyKey: IdempotencyKey,
): Promise<void> {
  await invokeFunction(
    'record-nudge',
    { ...bodyOf(target, idempotencyKey), answer },
    RecordNudgeResponse,
  );
}

/**
 * The person's own prompt history, through RLS (own rows only). Read for
 * `startedCircleFromPrompt`, which credits a new circle to "Start a circle";
 * the caps are the server's and do not read this.
 */
export async function ownNudgeHistory(): Promise<NudgeRecord[]> {
  const client = authClient();
  const { data: me } = await client.auth.getSession();
  const userId = me.session?.user.id;
  if (userId === undefined) return [];

  const { data, error } = await client
    .from('nudge_states')
    .select(NUDGE_STATE_COLUMNS)
    .eq('user_id', userId);
  if (error !== null) throw new Error('nudge history lookup failed');
  return (data ?? []).flatMap((row) => nudgeRecordOf(row) ?? []);
}

/**
 * When this identity got its saved place: the earliest of its sign-in methods,
 * which an anonymous identity has none of. Saving a place by email adds the
 * email identity at that moment, so for a guest who saved theirs this is when
 * they did (S2-07's `guest_started_circle`). Undefined when unknown.
 */
export async function savedPlaceSince(): Promise<Instant | undefined> {
  const { data } = await authClient().auth.getUser();
  const times = (data.user?.identities ?? [])
    .map((identity) => identity.created_at)
    .filter((at): at is string => typeof at === 'string' && at !== '')
    .map((at) => fromISO(at));
  return times.length === 0 ? undefined : (Math.min(...times) as Instant);
}
