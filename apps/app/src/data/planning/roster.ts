import type { authClient } from '../auth/client';

/** One name for an id on a plan screen. */
export type PlanRosterRow = {
  user_id: string;
  display_name_snapshot: string;
  /** `active`, or `removed` for somebody the plan still names. */
  status: 'active' | 'removed';
  joined_at: string;
};

/**
 * The names a plan screen needs for ids: the circle's active members, and a
 * member who has left only where the plan itself still names them (required, or
 * asked in this revision). `circle_members` is readable for the reader's own
 * row alone (ADR 0060), so the roster comes from `plan_roster`, a definer
 * function that answers an active member of the plan's circle.
 *
 * Shaped like a query result (`data`, `error`) so a caller's `Promise.all` and
 * its error check read as before.
 */
export async function planRoster(
  client: ReturnType<typeof authClient>,
  planId: string,
): Promise<{ data: PlanRosterRow[]; error: Error | null }> {
  const { data, error } = await client.rpc('plan_roster', { p_plan_id: planId });
  if (error !== null) return { data: [], error: new Error('roster lookup failed') };
  return {
    data: data.map((r) => ({
      user_id: r.user_id,
      display_name_snapshot: r.display_name,
      status: r.active ? 'active' : 'removed',
      joined_at: r.joined_at,
    })),
    error: null,
  };
}
