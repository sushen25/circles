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
  },
  resolve: {
    alias: {
      '@circles/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url)
        .pathname,
      '@circles/domain': new URL('../../packages/domain/src/index.ts', import.meta.url).pathname,
    },
  },
});
