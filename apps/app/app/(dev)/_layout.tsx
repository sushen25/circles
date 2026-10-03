import { Redirect, Slot } from 'expo-router';

import { hasBackend } from '../../src/data/auth/client';
import { devRoutesAvailable } from '../../src/platform/devRoutes';

/**
 * The guard on every route in this group (SUS-140). They render fixtures, so a
 * production build with a backend sends them to the front door instead. See
 * `devRoutesAvailable` for the rule.
 */
export default function DevLayout() {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  return devRoutesAvailable({ isDev, hasBackend: hasBackend() }) ? (
    <Slot />
  ) : (
    <Redirect href="/start" />
  );
}
