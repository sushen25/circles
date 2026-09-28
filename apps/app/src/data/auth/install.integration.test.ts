import { beforeAll, describe, expect, it } from 'vitest';

import { newIdempotencyKey } from '../functions';
import { accountFor, readStackConfig, sql, type Stack } from '../testing/stack.integration';

/**
 * `mark-app-installed` against the real stack (S3-01a): however often and
 * however concurrently the app says so, `profiles.app_installed_at` is stamped
 * once per profile and `growth.app_first_open_linked` is emitted once.
 *
 * Needs `pnpm db:start`.
 */

let stack: Stack;

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
});

async function mark(accessToken: string): Promise<{ installed_at: string; first_open: boolean }> {
  const response = await fetch(`${stack.url}/functions/v1/mark-app-installed`, {
    method: 'POST',
    headers: {
      apikey: stack.anonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ idempotency_key: newIdempotencyKey() }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { installed_at: string; first_open: boolean };
}

describe('mark-app-installed', () => {
  it('stamps app_installed_at exactly once per profile, and announces it once', async () => {
    const maya = await accountFor(stack, 'Maya');
    expect(
      sql(
        stack,
        `select app_installed_at is null from public.profiles where user_id = '${maya.userId}'`,
      ),
    ).toBe('t');

    const first = await mark(maya.accessToken);
    // A retry, a second phone and a reinstall, two of them at once.
    const later = await Promise.all([mark(maya.accessToken), mark(maya.accessToken)]);
    const again = await mark(maya.accessToken);

    expect(first.first_open).toBe(true);
    for (const call of [...later, again]) {
      expect(call.first_open).toBe(false);
      expect(call.installed_at).toBe(first.installed_at);
    }
    expect(
      new Date(
        sql(stack, `select app_installed_at from public.profiles where user_id = '${maya.userId}'`),
      ).toISOString(),
    ).toBe(first.installed_at);
    expect(
      sql(
        stack,
        `select count(*) from jobs.outbox
         where event_name = 'growth.app_first_open_linked' and aggregate_id = '${maya.userId}'`,
      ),
    ).toBe('1');
  });

  it("stamps each person's own profile, not anybody else's", async () => {
    const tom = await accountFor(stack, 'Tom');
    const jess = await accountFor(stack, 'Jess');

    expect((await mark(tom.accessToken)).first_open).toBe(true);
    expect(
      sql(
        stack,
        `select app_installed_at is null from public.profiles where user_id = '${jess.userId}'`,
      ),
    ).toBe('t');
    expect((await mark(jess.accessToken)).first_open).toBe(true);
  });
});
