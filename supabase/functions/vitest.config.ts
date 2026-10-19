import { defineConfig } from 'vitest/config';

// The kit's own suite. It runs under Node, not Deno, which is the reason the
// pieces worth testing are the ones that touch neither: a mapping from a
// database error to an HTTP status, a digest of a request body, the parsing of
// an `Authorization` header. The Deno runtime is reached only through `env.ts`
// and `Deno.serve`, both of which stay out of the way here.

// The device's time zone is part of a test's input (SUS-137). A suite that
// reads "today" from the machine passed in CI, which is UTC, and failed on a
// laptop in Sydney between midnight and 10:00, when the local date is a day
// ahead. Unless the run names a zone (`TZ=Australia/Sydney pnpm test:unit`, to
// look for exactly that), it is UTC, whatever machine it runs on.
process.env.TZ ??= 'UTC';

export default defineConfig({
  // The email templates are `.tsx` (ADR 0008). Deno reads each file's
  // `@jsxImportSource` pragma; esbuild is told the same thing here.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    name: 'functions',
    include: ['**/*.test.ts'],
    environment: 'node',
    // One process for this project's files rather than one each.
    //
    // `handlers.test.ts` loads all three function modules at import time, and each
    // pulls the whole `@circles/contracts` and `@circles/domain` source graph through
    // the aliases. Paid once per worker, that was enough extra weight on an
    // eleven-worker run to push the domain package's property tests past their
    // thirty-second timeout — a suite with nothing to do with this one, failing
    // because of how this one was scheduled. These files are milliseconds once
    // loaded, so sharing a process costs nothing worth having.
    pool: 'forks',
    // Vitest 4 dropped `poolOptions.forks.singleFork`; one worker is the same
    // thing (each file still gets a fresh module graph; `isolate: false` breaks the
    // handler tests, which load a function module that serves once). A project with its own `maxWorkers` needs its
    // own `groupOrder` or the run refuses to start; it runs as a group of its own.
    maxWorkers: 1,
    sequence: { groupOrder: 1 },
  },
  resolve: {
    alias: {
      '@circles/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url)
        .pathname,
      '@circles/domain': new URL('../../packages/domain/src/index.ts', import.meta.url).pathname,
    },
  },
});
