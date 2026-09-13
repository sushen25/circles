import { defineConfig } from 'vitest/config';

// The kit's own suite. It runs under Node, not Deno, which is the reason the
// pieces worth testing are the ones that touch neither: a mapping from a
// database error to an HTTP status, a digest of a request body, the parsing of
// an `Authorization` header. The Deno runtime is reached only through `env.ts`
// and `Deno.serve`, both of which stay out of the way here.
export default defineConfig({
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
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@circles/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url)
        .pathname,
      '@circles/domain': new URL('../../packages/domain/src/index.ts', import.meta.url).pathname,
    },
  },
});
