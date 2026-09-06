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
    name: '@circles/contracts',
    include: ['src/**/*.test.ts'],
  },
});
