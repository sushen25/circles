import { z } from 'zod';

/** `process-scheduled-jobs` — Cron. Drains the outbox, sends what is due, expires what has passed, retries with capped backoff. */
export const ProcessScheduledJobsRequest = z.object({
  lease_seconds: z.int().positive().max(300).optional(),
});
export type ProcessScheduledJobsRequest = z.infer<typeof ProcessScheduledJobsRequest>;

export const ProcessScheduledJobsResponse = z.object({ processed: z.int().nonnegative() });
export type ProcessScheduledJobsResponse = z.infer<typeof ProcessScheduledJobsResponse>;
