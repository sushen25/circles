import { STOP_TIME_OPTIONS, type StopTimeOption } from '@circles/domain';
import { z } from 'zod';

import { CircleId, PlanId, ShortCode, UserId } from '../ids.js';
import { DailyWindow, DateWindow, DurationMinutes, Instant } from '../time.js';
import { Mutation, Quorum } from './shared.js';

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
  /**
   * `quiet` is "See if people are keen" (spec §5.4): no organiser, a threshold
   * the server works out, and a stop time from `stop_time`. It takes a quiet
   * window (not `custom`) and none of the fields below that belong to an
   * organiser — quorum, required members, a deadline — because a quiet ask has
   * none until it opens.
   */
  mode: z.enum(['named', 'quiet']).default('named'),
  /**
   * `quiet` only, and required there: when to stop asking, as the option the
   * person picked (`stopTimeOptions` in `packages/domain`). Never an instant —
   * the server resolves it with `resolveStopTime`, so the stop time is always
   * one the window offers and always before the last possible start.
   */
  stop_time: z.enum(STOP_TIME_OPTIONS as readonly [StopTimeOption, ...StopTimeOption[]]).optional(),
  /**
   * Trimmed here, because `plans_title_length` counts the trimmed length: a
   * title of three spaces satisfied `min(1)`, reached the RPC and came back as
   * an unclassified 500 for what is an ordinary invalid request.
   */
  title: z.string().trim().min(1).max(60),
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
  quorum: Quorum.optional(),
  /** Absent means "the organiser alone"; an empty array means nobody. */
  required_member_ids: z.array(UserId).optional(),
  /** Absent means the preset's default deadline. */
  response_deadline: Instant.optional(),
}).superRefine((request, context) => {
  const refuse = (path: string, message: string) =>
    context.addIssue({ code: 'custom', path: [path], message });
  if (request.mode === 'named') {
    if (request.stop_time !== undefined) refuse('stop_time', 'A named plan has no stop time.');
    return;
  }
  if (request.stop_time === undefined) refuse('stop_time', 'A quiet ask needs a stop time.');
  if (request.preset === 'custom') refuse('preset', 'A quiet ask picks one of four windows.');
  for (const field of ['custom', 'quorum', 'required_member_ids', 'response_deadline'] as const) {
    if (request[field] !== undefined) refuse(field, 'A quiet ask has no organiser to choose this.');
  }
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

export const CreatePlanResponse = z.object({
  plan_id: PlanId,
  short_code: ShortCode,
  /** What the defaults actually resolved to, so the client can show the card it promised. */
  window: DateWindow,
  daily: DailyWindow,
  duration_minutes: DurationMinutes,
  quorum: Quorum,
  /** For a quiet ask, its stop time: replaced by a real deadline when it opens. */
  response_deadline: Instant,
  /**
   * A quiet ask's two facts its initiator may see while it asks (spec §5.4.3):
   * when it closes and what opens it. Never a count. Absent for a named plan.
   */
  quiet: z.object({ closes_at: Instant, threshold: z.int().min(2) }).optional(),
});
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;
