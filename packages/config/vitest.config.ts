import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite runs 20 projects in parallel, one of them jsdom with 73
    // screens. Tests here take milliseconds; the default 5s is spent waiting
    // for a worker, and a test that times out under contention is a flake
    // rather than a finding.
    testTimeout: 30_000,
    name: '@circles/config',
    include: ['src/**/*.test.ts'],
  },
});
