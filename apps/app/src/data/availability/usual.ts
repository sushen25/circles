import type { DayPart } from '@circles/domain';

import { authClient } from '../auth/client';

/**
 * The day-parts this person has offered before in this plan's circle, limited
 * to the ones this plan asks about, for "Use my previous times" (ADR 0005,
 * SUS-159, ADR 0037's amendment).
 *
 * **One call, `public.previous_dayparts`, which reads the caller's own rows.**
 * It answers "which of these parts has this member offered in this circle"
 * from their earlier answers and the stored `member_dayparts` counts, and
 * returns at most six strings: no window, no date, nothing of anybody else's.
 * The member is the signed-in session, never a parameter. Nothing is stored
 * when somebody answers, so there is no summary to fall out of date.
 *
 * A name this client does not know is dropped rather than painted. An empty
 * list says there is nothing to offer, and a failure throws: the caller treats
 * both as no offer, because this is a shortcut and never an error.
 */
const PARTS: ReadonlySet<string> = new Set<DayPart>([
  'weekday_morning',
  'weekday_afternoon',
  'weekday_evening',
  'weekend_morning',
  'weekend_afternoon',
  'weekend_evening',
]);

export async function usualTimes(planId: string): Promise<readonly DayPart[]> {
  const { data, error } = await authClient().rpc('previous_dayparts', { p_plan_id: planId });
  if (error !== null) throw new Error('previous_dayparts failed');
  return (data ?? []).filter((part): part is DayPart => PARTS.has(part));
}
