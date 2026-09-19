import { authClient } from '../auth/client';

/**
 * What this circle calls the person in the session, for "Thanks, Priya". Read
 * through RLS: a member can read the circle's members, and the row is theirs.
 * `null` when there is no such row — the screen then thanks them without a name.
 */
export async function ownNameIn(circleId: string): Promise<string | null> {
  const client = authClient();
  const { data: me } = await client.auth.getSession();
  const userId = me.session?.user.id;
  if (userId === undefined) return null;

  const { data, error } = await client
    .from('circle_members')
    .select('display_name_snapshot')
    .eq('circle_id', circleId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error !== null) throw new Error('own name lookup failed');
  return data?.display_name_snapshot ?? null;
}
