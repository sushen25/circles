import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@circles/tokens',
    include: ['src/**/*.test.ts'],
  },
});
