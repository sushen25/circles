import { z } from 'zod';

import { CircleId, PlanId, ShortCode, UserId } from '../ids.js';
import { DailyWindow, DateWindow, DurationMinutes, Instant } from '../time.js';
import { Mutation } from './shared.js';

/**
 * `create-plan` — a named plan, from a preset and the circle's defaults.
 *
 * The client sends what the person chose, not what the database needs: a
 * preset rather than dates, and nothing at all for duration, quorum or deadline
 * unless they were edited. `packages/domain` turns that into a window
 * (`resolvePreset`), a deadline (`defaultDeadline`) and a quorum (`quorumFor`),
 * which is why those rules exist in one place and not in a screen.
 *
 * "One card summarising the defaults … Ask the group" (spec §5.1, step 7) is
 * this request with three fields.
 */
export const CreatePlanRequest = Mutation.extend({
  circle_id: CircleId,
  /** Quiet asks land in S2-02; until then this refuses them with `not_yet`. */
  mode: z.enum(['named', 'quiet']).default('named'),
  title: z.string().min(1).max(60),
  category: z.enum(['catch_up', 'dinner', 'drinks', 'coffee', 'activity']).default('catch_up'),
  preset: z.enum(['tonight', 'this_weekend', 'next_7_days', 'next_14_days', 'custom']),
  /** Required by `custom`, ignored otherwise: the dates the person picked. */
  custom: DateWindow.optional(),
  /**
   * An explicit band, overriding the preset's suggestion. The presets' bands are
   * defaults rather than limits (spec §5.3), so a Sunday afternoon is askable.
   */
  daily: DailyWindow.optional(),
  duration_minutes: DurationMinutes.optional(),
  /** Absent means the circle's default, or `max(2, ceil(n × 0.6))` if it has none. */
  quorum: z.int().positive().optional(),
  /** Absent means "the organiser alone"; an empty array means nobody. */
  required_member_ids: z.array(UserId).optional(),
  /** Absent means the preset's default deadline. */
  response_deadline: Instant.optional(),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

export const CreatePlanResponse = z.object({
  plan_id: PlanId,
  short_code: ShortCode,
  /** What the defaults actually resolved to, so the client can show the card it promised. */
  window: DateWindow,
  daily: DailyWindow,
  duration_minutes: DurationMinutes,
  quorum: z.int().positive(),
  response_deadline: Instant,
});
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;
