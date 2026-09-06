import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@circles/config',
    include: ['src/**/*.test.ts'],
  },
});
