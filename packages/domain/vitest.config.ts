import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite runs 21 projects in parallel, one of them jsdom with 73
    // screens. Tests here take milliseconds; the default 5s is spent waiting
    // for a worker, and a test that times out under contention is a flake
    // rather than a finding.
    //
    // Thirty seconds was chosen for twenty projects. S1-13 added the twenty-first
    // (`supabase/functions`) and two of the property tests here started taking
    // forty-five to sixty seconds of *waiting* on an eleven-core machine — the same
    // tests that finish in under a second when this project runs alone. Raising the
    // ceiling rather than thinning the properties, because the reasoning above has
    // not changed and the work has not grown.
    testTimeout: 120_000,
    name: '@circles/domain',
    include: ['src/**/*.test.ts'],
  },
});
