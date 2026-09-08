/**
 * Builders for the circle context. `shared/fixtures.ts` carried placeholder
 * `CircleFixture` and `MemberFixture` shapes and said each Slice 1 ticket would
 * "replace the corresponding type with the real one"; this is that replacement,
 * so there is one `circle()` in the package rather than two that drift.
 *
 * Reached as `fixtures.circle()` exactly as before — `src/fixtures.ts`
 * aggregates the shared builders and the per-context ones.
 */

import { MELBOURNE } from '../shared/fixtures.js';
import { type Instant, fromISO } from '../shared/instant.js';
import { type Circle, type Member, type UserId, circleId, userId } from './types.js';

/** Saturday 8 August 2026, 6:30 pm Melbourne — the canvas's "last caught up". */
export const LAST_MET: Instant = fromISO('2026-08-08T08:30:00Z');

export const OWNER: UserId = userId('user-owner');

/**
 * Passing `undefined` for a field means "absent", so a test can write
 * `circle({ lastMetAt: undefined })` for a circle that has never met. Spreading
 * would instead set the key to `undefined`, which `exactOptionalPropertyTypes`
 * rejects — the distinction the compiler is drawing is a real one, and this is
 * the one place worth absorbing it.
 */
type Overrides<T> = { [K in keyof T]?: T[K] | undefined };

function build<T extends object>(base: T, overrides: Overrides<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as T;
}

export function circle(overrides: Overrides<Circle> = {}): Circle {
  return build(
    {
      id: circleId('circle-1'),
      ownerUserId: OWNER,
      name: 'Sunday Crew',
      color: 'sky',
      zone: MELBOURNE,
      cadence: 'monthly',
      defaultDurationMinutes: 120,
      status: 'active',
      lastMetAt: LAST_MET,
    },
    overrides,
  );
}

let seq = 0;

export function member(overrides: Overrides<Member> = {}): Member {
  seq += 1;
  return build(
    {
      circleId: circleId('circle-1'),
      userId: userId(`user-${seq}`),
      displayName: `Member ${seq}`,
      role: 'member',
      status: 'active',
      joinedAt: fromISO('2026-01-01T00:00:00Z'),
      mutedQuietAsks: false,
      mutedAll: false,
      isPermanent: true,
    },
    overrides,
  );
}
