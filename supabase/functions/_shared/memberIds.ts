import type { Db } from './db.ts';

/**
 * The circle and plan ids a caller may have on an analytics row (SUS-185).
 *
 * An id in a payload is the caller's claim. It is kept only when the caller is
 * an **active member** of that circle (a plan counts through its circle), and
 * `public.analytics_member_ids` answers for the whole batch in one call. The
 * ids are then compared by exact value against what the database said, so a
 * caller cannot widen the answer by the way it spells an id.
 *
 * Nobody signed in is a member of nothing, and there is no call to make.
 */
export interface MemberIds {
  circles: ReadonlySet<string>;
  plans: ReadonlySet<string>;
}

const NONE: MemberIds = { circles: new Set(), plans: new Set() };

export async function memberIdsOf(
  db: Db,
  userId: string | undefined,
  circleClaims: readonly unknown[],
  planClaims: readonly unknown[],
): Promise<MemberIds> {
  if (userId === undefined) return NONE;
  const unique = (values: readonly unknown[]): string[] => [
    ...new Set(values.filter((value): value is string => typeof value === 'string')),
  ];
  if (unique(circleClaims).length === 0 && unique(planClaims).length === 0) return NONE;

  const { data, error } = await db.rpc('analytics_member_ids', {
    p_user_id: userId,
    p_circle_ids: unique(circleClaims),
    p_plan_ids: unique(planClaims),
  });
  if (error !== null) throw error;

  const answer = (data ?? {}) as { circle_ids?: unknown; plan_ids?: unknown };
  const asSet = (value: unknown): Set<string> =>
    new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  return { circles: asSet(answer.circle_ids), plans: asSet(answer.plan_ids) };
}
