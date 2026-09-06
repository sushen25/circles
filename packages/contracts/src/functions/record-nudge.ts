import { z } from 'zod';

import { Mutation } from './shared.js';

/** `record-nudge` — Apply the nudge caps and record that one was shown or answered. */
export const RecordNudgeRequest = Mutation.extend({
  moment: z.enum(['confirmed', 'reattached', 'second_response', 'after_attendance']),
  action: z.enum(['shown', 'dismissed', 'tapped']),
});
export type RecordNudgeRequest = z.infer<typeof RecordNudgeRequest>;

export const RecordNudgeResponse = z.object({ suppressed: z.boolean() });
export type RecordNudgeResponse = z.infer<typeof RecordNudgeResponse>;
