import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

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
