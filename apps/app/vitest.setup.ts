import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * React Native's build-time global, which Vitest is not.
 *
 * Metro and the Expo bundlers define `__DEV__`; nothing does under Vitest, so
 * the first Expo module that reads it throws `__DEV__ is not defined` — which
 * `expo-modules-core` does at import time, on the module's very first line of
 * work. Unit tests never saw it because they mock `expo-secure-store`; the
 * integration suite imports the real one and stops dead.
 *
 * `false`, not `true`: a test run is not a development session, and the
 * development branches are the chatty ones — logger set-up, invariant warnings —
 * that would otherwise write noise into every run.
 */
(globalThis as { __DEV__?: boolean }).__DEV__ ??= false;

// Vitest only auto-cleans when `globals` is on, and it is not; without this,
// one test's DOM is still mounted during the next and queries match twice.
afterEach(cleanup);
