import { Redirect, Slot } from 'expo-router';

import { hasBackend } from '../../src/data/auth/client';
import { devRoutes } from '../../src/platform/devRoutes';
import { NotFoundScreen } from '../../src/features/system/NotFoundScreen';

/**
 * The guard on every route in this group (SUS-140, SUS-119). They render
 * fixtures: a deployed build with a backend sends them to the front door, and
 * the production build answers not-found. See `devRoutes` for the rule.
 */
export default function DevLayout() {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const shown = devRoutes({
    isDev,
    hasBackend: hasBackend(),
    appEnv: process.env.EXPO_PUBLIC_APP_ENV,
  });
  if (shown === 'shown') return <Slot />;
  return shown === 'not-found' ? <NotFoundScreen /> : <Redirect href="/start" />;
}
