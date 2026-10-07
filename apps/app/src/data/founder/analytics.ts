import { FounderAnalytics } from '@circles/contracts';

import { authClient } from '../auth/client';

/**
 * The founder's analytics (SUS-166): one call, `public.founder_analytics`.
 *
 * The function checks `private.allowlist` against `auth.uid()` and refuses
 * everybody else with `insufficient_privilege` (`42501`). That refusal is
 * "there is no such page" and nothing else: it is its own error, so the screen
 * can show the not-found screen and never one that says the route exists. It
 * is also what a signed-out browser gets.
 *
 * Nothing here is recorded: no analytics event for viewing this screen, which
 * would only count the founder.
 */
export class NotFounderError extends Error {
  constructor() {
    super('not on the allowlist');
    this.name = 'NotFounderError';
  }
}

export const founderKeys = {
  analytics: (userId: string | undefined, since: string) =>
    ['founder-analytics', userId, since] as const,
};

export async function fetchFounderAnalytics(since: string): Promise<FounderAnalytics> {
  const { data, error } = await authClient().rpc('founder_analytics', { p_since: since });
  if (error !== null) {
    if (error.code === '42501') throw new NotFounderError();
    throw new Error('founder analytics not loaded');
  }
  return FounderAnalytics.parse(data);
}
