import { URL, fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Components are tested through `react-native-web` in jsdom.
 *
 * React Native Testing Library would be the obvious choice, but it peers on
 * Jest, and this workspace runs Vitest everywhere else (architecture §16).
 * Rendering through react-native-web is not a compromise for a universal app:
 * it is the exact path the web build already takes, so these tests exercise
 * shipping code rather than a test-only renderer.
 */
export default defineConfig({
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      // See the note in the stub: the real package cannot load under Vitest,
      // and these tests are about our components, not about its rendering.
      'react-native-svg': fileURLToPath(
        new URL('./src/test/react-native-svg-stub.tsx', import.meta.url),
      ),
      '@circles/tokens': fileURLToPath(
        new URL('../../packages/tokens/src/index.ts', import.meta.url),
      ),
      '@circles/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
      '@circles/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
      '@circles/config': fileURLToPath(
        new URL('../../packages/config/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    // The suite runs 20 projects in parallel, one of them jsdom with 73
    // screens. Tests here take milliseconds; the default 5s is spent waiting
    // for a worker, and a test that times out under contention is a flake
    // rather than a finding.
    testTimeout: 30_000,
    name: 'app',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
