import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

import './src/test/shift-clock';

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

// How long `findBy*` and `waitFor` wait: ten seconds, not Testing Library's one
// (SUS-163). The wait is for a screen to render, and under load that is
// dominated by the time this worker spends waiting for a core, not by the
// screen: with the whole suite running beside a busy machine (or CI's three
// workers on a shared runner) a first render of a big screen took longer than
// a second and `usualTimes`, `settings` and `lifecycle` failed under load and passed alone. A
// wait that succeeds returns the moment its condition holds, so a passing test
// is no slower; only a test that is really broken waits longer to say so. The
// same reasoning, and the same number as Playwright's `expect` timeout, as
// `testTimeout` in `vitest.config.ts`.
configure({ asyncUtilTimeout: 10_000 });
