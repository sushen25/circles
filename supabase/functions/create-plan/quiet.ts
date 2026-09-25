import { type CreatePlanRequest, type CreatePlanResponse, DateWindow } from '@circles/contracts';
import {
  type DurationMinutes,
  type Instant,
  type Zone,
  isQuietPreset,
  resolvePreset,
  resolveStopTime,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { fromInstant } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';

/**
 * "See if people are keen" (spec §5.4): the quiet half of `create-plan`.
 *
 * Two numbers are the domain's and are worked out here, from what the person
 * chose: the window (`resolvePreset`) and the stop time (`resolveStopTime`,
 * from the option's *name* — an instant from the client is never taken, so the
 * stop time is always one the window offers and always before the last
 * possible start). Everything else is `public.create_quiet_ask`'s — the service
 * role's, with the verified caller as its actor — under the
 * circle's lock: the threshold for the members it has at that moment, whether
 * this member may ask at all (`canCreateQuietAsk`, mirrored in the same order),
 * and the two private rows — who asked, and their own keen answer.
 *
 * Nothing about the caller is logged here or by the wrapper beyond the
 * refusal's reason, and the reason never travels with their id: "refused for
 * already asking" is the initiator's identity with extra steps (SUS-49).
 */

type QuietRequest = {
  readonly body: CreatePlanRequest;
  /** The verified caller: `create_quiet_ask` is the service role's (review round 1). */
  readonly actorId: string;
  readonly service: Db;
  readonly zone: Zone;
  readonly at: Instant;
  readonly durationMinutes: DurationMinutes;
};

export async function createQuietAsk({
  body,
  actorId,
  service,
  zone,
  at,
  durationMinutes,
}: QuietRequest): Promise<CreatePlanResponse> {
  // The contract refuses both already; a type cannot say "required when".
  if (body.stop_time === undefined || !isQuietPreset(body.preset)) {
    throw new Refusal('stop_time_unavailable', 'Pick when to stop asking.');
  }
  const preset = body.preset;

  const resolved = resolvePreset(preset, at, zone, { durationMinutes, daily: body.daily });
  if (typeof resolved === 'string') throw new Refusal(resolved, 'That window does not work.');

  const stopAt = resolveStopTime(preset, body.stop_time, at, {
    window: resolved.window,
    daily: resolved.daily,
    durationMinutes,
    zone,
  });
  if (stopAt === undefined) {
    // Offered when the screen was drawn, gone by the time it was tapped — or
    // never offered for this window. Either way the screen asks again.
    throw new Refusal('stop_time_unavailable', 'That stop time is not available now.');
  }

  // As the service role, with the actor from the verified JWT: the window, the
  // preset and the stop time are this function's resolution of the person's
  // choice, and an RPC a client could call directly would take any it liked.
  const { data, error } = await service.rpc('create_quiet_ask', {
    p_actor: actorId,
    p_circle_id: body.circle_id,
    p_title: body.title,
    p_category: body.category,
    p_window_start: resolved.window.start,
    p_window_end: resolved.window.end,
    p_daily_start_local: resolved.daily.startMin,
    p_daily_end_local: resolved.daily.endMin,
    p_duration_minutes: durationMinutes,
    p_preset: preset,
    p_quiet_expires_at: fromInstant(stopAt),
  });
  if (error !== null) throw error;

  const plan = (Array.isArray(data) ? data[0] : data) as {
    id: string;
    short_code: string;
    quorum: number;
    quiet_threshold: number;
  };
  const closesAt = fromInstant(stopAt) as CreatePlanResponse['response_deadline'];

  return {
    plan_id: plan.id as CreatePlanResponse['plan_id'],
    short_code: plan.short_code as CreatePlanResponse['short_code'],
    window: DateWindow.parse({ start: resolved.window.start, end: resolved.window.end }),
    daily: { startMin: resolved.daily.startMin, endMin: resolved.daily.endMin },
    duration_minutes: durationMinutes,
    quorum: plan.quorum,
    response_deadline: closesAt,
    quiet: { closes_at: closesAt, threshold: plan.quiet_threshold },
  };
}
