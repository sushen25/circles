import type { ResponseStatus } from '@circles/domain';

import { authClient } from '../auth/client';
import type { OwnAnswer } from './plan';

/**
 * The reader's own answer to a plan's current revision, or `null` when they
 * have not answered it (SUS-233). The same read the guest editor makes
 * (`planToAnswer`): `plan_responses` and `willing_windows` are readable by
 * their owner through RLS, so it asks no function and adds nothing about
 * anybody else. The organiser's picker adds it to the day counts, which are
 * the others' alone.
 */
export async function ownResponse(planId: string, revision: number): Promise<OwnAnswer | null> {
  const client = authClient();
  const { data: me } = await client.auth.getSession();
  const userId = me.session?.user.id;
  if (userId === undefined) return null;
  const { data, error } = await client
    .from('plan_responses')
    .select('status, submitted_at, willing_windows (starts_at, ends_at)')
    .eq('plan_id', planId)
    .eq('revision', revision)
    .eq('user_id', userId)
    .maybeSingle();
  if (error !== null) throw new Error('own answer lookup failed');
  if (data === null) return null;
  return {
    status: data.status as ResponseStatus,
    windows: [...(data.willing_windows ?? [])]
      .map((w) => ({ start: w.starts_at, end: w.ends_at }))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    submittedAt: data.submitted_at,
  };
}
