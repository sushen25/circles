import { z } from 'zod';

import { Instant } from '../time.js';
import { Mutation } from './shared.js';

/**
 * `mark-app-installed` — the installed app, opened signed in (S3-01a,
 * guest-to-app flow §10): the caller's identity tier becomes `app`.
 *
 * Called by the app on every sign-in, and safe to be: the first call stamps
 * `profiles.app_installed_at` and announces `growth.app_first_open_linked`, and
 * every later one — a retry, a second device, a reinstall — changes nothing and
 * answers with the first time. `first_open` says which this was, so the client
 * counts `app_first_open_linked` once rather than once per sign-in.
 *
 * Reasons it can refuse: `requires_saved_place` (a guest session: there is no
 * app tier without a saved place, and the app signs somebody in first).
 */
export const MarkAppInstalledRequest = Mutation;
export type MarkAppInstalledRequest = z.infer<typeof MarkAppInstalledRequest>;

export const MarkAppInstalledResponse = z.object({
  installed_at: Instant,
  first_open: z.boolean(),
});
export type MarkAppInstalledResponse = z.infer<typeof MarkAppInstalledResponse>;
