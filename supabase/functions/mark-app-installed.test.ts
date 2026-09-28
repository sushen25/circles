import { describe, expect, it } from 'vitest';

import { Refusal } from './_shared/problem.ts';
import { type InstallStore, markAppInstalled } from './mark-app-installed/mark.ts';

/**
 * `mark-app-installed`'s decision, over a store kept in memory (S3-01a). That
 * the column is stamped once, and the event emitted once, is the database's
 * promise and pgTAP's to prove (`260_app_installed.sql`); what the real
 * function does against the stack is `install.integration.test.ts`'s.
 */
function memory() {
  let stamped: string | null = null;
  let calls = 0;
  const store: InstallStore = {
    mark: () => {
      calls += 1;
      if (stamped !== null) return Promise.resolve({ installed_at: stamped, first_open: false });
      stamped = '2026-09-26 08:00:00.123456+00';
      return Promise.resolve({ installed_at: stamped, first_open: true });
    },
  };
  return { store, calls: () => calls };
}

describe('mark-app-installed', () => {
  it('says the first call was the first open, and every later one was not', async () => {
    const { store } = memory();
    const first = await markAppInstalled(store, false);
    const again = await markAppInstalled(store, false);

    expect(first.first_open).toBe(true);
    expect(again.first_open).toBe(false);
    expect(again.installed_at).toBe(first.installed_at);
  });

  it('answers in ISO 8601 whatever Postgres wrote', async () => {
    const { store } = memory();
    expect((await markAppInstalled(store, false)).installed_at).toBe('2026-09-26T08:00:00.123Z');
  });

  it('refuses a guest before anything is written', async () => {
    const { store, calls } = memory();
    const refusal = await markAppInstalled(store, true).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(Refusal);
    expect((refusal as Refusal).reason).toBe('requires_saved_place');
    expect(calls()).toBe(0);
  });

  it('treats a missing profile as a fault, not an answer', async () => {
    await expect(
      markAppInstalled({ mark: () => Promise.resolve(undefined) }, false),
    ).rejects.toThrow();
  });
});
