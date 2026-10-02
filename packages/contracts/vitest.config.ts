import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The device's time zone is part of a test's input (SUS-137). A suite that
// reads "today" from the machine passed in CI, which is UTC, and failed on a
// laptop in Sydney between midnight and 10:00, when the local date is a day
// ahead. Unless the run names a zone (`TZ=Australia/Sydney pnpm test:unit`, to
// look for exactly that), it is UTC, whatever machine it runs on.
process.env.TZ ??= 'UTC';

export default defineConfig({
  resolve: {
    alias: {
      // Run against domain source, so the suite needs no prior `tsc -b`.
      '@circles/domain': fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // The suite runs 20 projects in parallel, one of them jsdom with 73
    // screens. Tests here take milliseconds; the default 5s is spent waiting
    // for a worker, and a test that times out under contention is a flake
    // rather than a finding.
    testTimeout: 30_000,
    name: '@circles/contracts',
    include: ['src/**/*.test.ts'],
  },
});
