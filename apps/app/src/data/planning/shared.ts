import { authClient } from '../auth/client';

/**
 * What PlanShared needs to write the message (spec §5.1 step 8): the plan's
 * short link, its deadline, the circle's name and zone. Read through RLS as a
 * member, so a plan the reader cannot see is `null`.
 *
 * Throws without the id in the message.
 */
export type PlanToShare = {
  id: string;
  code: string;
  circleId: string;
  circleName: string;
  zone: string;
  responseDeadline: string;
  /** Inclusive local dates. */
  windowStart: string;
  windowEnd: string;
};

export async function planToShare(planId: string): Promise<PlanToShare | null> {
  const client = authClient();
  const { data: plan, error } = await client
    .from('plans')
    .select('id, short_code, circle_id, time_zone, response_deadline, window_start, window_end')
    .eq('id', planId)
    .maybeSingle();
  if (error !== null) {
    if (error.code === '22P02') return null;
    throw new Error('plan lookup failed');
  }
  if (plan === null) return null;

  const { data: circle, error: circleError } = await client
    .from('circles')
    .select('name')
    .eq('id', plan.circle_id)
    .maybeSingle();
  if (circleError !== null) throw new Error('plan lookup failed');

  return {
    id: plan.id,
    code: plan.short_code,
    circleId: plan.circle_id,
    circleName: circle?.name ?? '',
    zone: plan.time_zone,
    responseDeadline: plan.response_deadline,
    windowStart: plan.window_start,
    windowEnd: plan.window_end,
  };
}
