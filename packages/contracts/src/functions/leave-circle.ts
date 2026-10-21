import { z } from 'zod';

import { CircleId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `leave-circle` — any member, guests included, takes themselves out of a
 * circle (spec §4.5, §13; S4-05, ADR 0083). The owner's Remove done by the
 * person it is done to: access ends at once, their answers to plans still
 * asking are deleted, and each such plan is recalculated in the request.
 *
 * Reasons: `owner_cannot_leave` (the owner deletes their account, which hands
 * the circle on, or has it archived); `member_not_found` for anybody not active
 * in the circle, removed already included.
 */
export const LeaveCircleRequest = Mutation.extend({ circle_id: CircleId });
export type LeaveCircleRequest = z.infer<typeof LeaveCircleRequest>;

export const LeaveCircleResponse = z.object({
  ok: z.literal(true),
  /** Plans still asking that lost this member's answers, recalculated in the request. */
  affected_plans: z.int().min(0),
});
export type LeaveCircleResponse = z.infer<typeof LeaveCircleResponse>;
