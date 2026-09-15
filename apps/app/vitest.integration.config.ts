import { mergeConfig } from 'vitest/config';

import appConfig from './vitest.config';

/**
 * The tests that need the local stack running.
 *
 * Kept out of `test:unit` on purpose, and not by a skip. A test that skips when
 * Postgres is unreachable is a test that silently stops running the moment the
 * thing it needs goes missing — which is the same failure mode as the Turnstile
 * secret this ticket just closed. So these live behind their own command,
 * `pnpm test:integration`, which `pnpm check` runs *after* `db:test` has reset
 * the database, where the stack is guaranteed to be up and the schema fresh.
 *
 * They are also the only tests in the repository that talk to a real auth
 * server. Everything below them is mocked; this one exists because the mock is
 * exactly what cannot prove `claim-identity` keeps a membership.
 */
const config = mergeConfig(appConfig, {
  test: {
    name: 'app-integration',
    // A real auth server, a real mail catcher and three round trips per step.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One at a time: they share one auth server and one mail catcher, and a
    // parallel run makes "the newest message to this address" a race.
    fileParallelism: false,
  },
});

/**
 * Assigned, not merged. `mergeConfig` **concatenates** arrays, so passing these
 * through the merge inherited the unit config's `exclude` — the one that hides
 * `*.integration.test.ts` — and this suite ran the unit tests instead, reporting
 * 113 passed while the file it exists for never executed. A green suite that
 * runs nothing is worse than a red one.
 */
config.test.include = ['src/**/*.integration.test.ts'];
config.test.exclude = ['**/node_modules/**'];

export default config;
