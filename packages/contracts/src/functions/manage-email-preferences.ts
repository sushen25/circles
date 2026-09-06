import { z } from 'zod';

import { CircleId, OpaqueToken } from '../ids.js';

/** `manage-email-preferences` — Show or disable subscriptions without signing in. */
export const ManageEmailPreferencesRequest = z.object({
  token: OpaqueToken,
  disable: z.boolean().optional(),
});
export type ManageEmailPreferencesRequest = z.infer<typeof ManageEmailPreferencesRequest>;

export const ManageEmailPreferencesResponse = z.object({
  subscriptions: z.array(z.object({ circle_id: CircleId, enabled: z.boolean() })),
});
export type ManageEmailPreferencesResponse = z.infer<typeof ManageEmailPreferencesResponse>;
