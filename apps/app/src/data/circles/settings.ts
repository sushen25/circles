import type { Cadence, NudgePolicy } from '@circles/domain';

import { authClient } from '../auth/client';
import { whoAmI } from './rows';

/**
 * Circle settings and notification settings: the writes that are ordinary
 * updates through RLS rather than functions (spec §5.2).
 *
 * - **The owner's choices** — cadence, who gets nudged, colour, archiving —
 *   are `circles_update_owner`, limited by a column grant to exactly those
 *   columns. A member's update matches no row.
 * - **A member's own switches** — "all notifications", quiet asks, nudges —
 *   are `circle_members_update_own`, their row only and only while they are in
 *   the circle, and the grant is those three columns.
 *
 * RLS refuses an update by matching nothing rather than by erroring, so each
 * write asks for the row back and treats none as a refusal. Without that a
 * member's tap on an owner's switch would look saved and quietly revert.
 */
export class NotSavedError extends Error {
  constructor() {
    super('circle setting not saved');
    this.name = 'NotSavedError';
  }
}

export type CirclePatch = {
  cadence?: Cadence;
  nudgePolicy?: NudgePolicy;
  color?: string;
  status?: 'active' | 'archived';
};

export async function updateCircle(id: string, patch: CirclePatch): Promise<void> {
  const row: { cadence?: string; nudge_policy?: string; color?: string; status?: string } = {};
  if (patch.cadence !== undefined) row.cadence = patch.cadence;
  if (patch.nudgePolicy !== undefined) row.nudge_policy = patch.nudgePolicy;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.status !== undefined) row.status = patch.status;

  const { data, error } = await authClient().from('circles').update(row).eq('id', id).select('id');
  if (error !== null || data.length === 0) throw new NotSavedError();
}

export type SwitchPatch = {
  mutedAll?: boolean;
  mutedQuietAsks?: boolean;
  mutedNudges?: boolean;
};

export async function saveMySwitches(circleId: string, patch: SwitchPatch): Promise<void> {
  const client = authClient();
  const me = await whoAmI(client);
  if (me === undefined) throw new NotSavedError();

  const row: { muted_all?: boolean; muted_quiet_asks?: boolean; muted_nudges?: boolean } = {};
  if (patch.mutedAll !== undefined) row.muted_all = patch.mutedAll;
  if (patch.mutedQuietAsks !== undefined) row.muted_quiet_asks = patch.mutedQuietAsks;
  if (patch.mutedNudges !== undefined) row.muted_nudges = patch.mutedNudges;

  const { data, error } = await client
    .from('circle_members')
    .update(row)
    .eq('circle_id', circleId)
    .eq('user_id', me)
    .select('circle_id');
  if (error !== null || data.length === 0) throw new NotSavedError();
}

/** One circle's switches, for the notification settings screen. */
export type CircleSwitches = {
  circleId: string;
  circleName: string;
  mutedAll: boolean;
  mutedQuietAsks: boolean;
  mutedNudges: boolean;
};

/** The reader's switches in every circle they are active in, archived ones left out. */
export async function mySwitchesEverywhere(): Promise<CircleSwitches[]> {
  const client = authClient();
  const me = await whoAmI(client);
  if (me === undefined) return [];

  const { data, error } = await client
    .from('circle_members')
    .select(
      'circle_id, muted_all, muted_quiet_asks, muted_nudges, joined_at, circles(name, status)',
    )
    .eq('user_id', me)
    .eq('status', 'active')
    .order('joined_at', { ascending: true });
  if (error !== null) throw new Error('notification settings lookup failed');

  return data
    .filter((row) => row.circles !== null && row.circles.status === 'active')
    .map((row) => ({
      circleId: row.circle_id,
      circleName: row.circles?.name ?? '',
      mutedAll: row.muted_all,
      mutedQuietAsks: row.muted_quiet_asks,
      mutedNudges: row.muted_nudges,
    }));
}
