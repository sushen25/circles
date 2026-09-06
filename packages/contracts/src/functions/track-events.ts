import { z } from 'zod';

import { TrackedEvent } from '../analytics.js';

/** `track-events` — Validate against the catalogue, strip anything not in the schema, insert. */
export const TrackEventsRequest = z.object({ events: z.array(TrackedEvent).max(50) });
export type TrackEventsRequest = z.infer<typeof TrackEventsRequest>;

export const TrackEventsResponse = z.object({
  accepted: z.int().nonnegative(),
  rejected: z.int().nonnegative(),
});
export type TrackEventsResponse = z.infer<typeof TrackEventsResponse>;
