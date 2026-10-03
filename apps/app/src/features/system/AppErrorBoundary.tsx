import { router } from 'expo-router';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { reportClientError } from '../../analytics/clientError';

import { CrashScreen } from './CrashScreen';

/**
 * Expo Router's `ErrorBoundary` export (SUS-112, audit H7): what a render error
 * on any screen lands on, in place of a blank page.
 *
 * It brings its own `SafeAreaProvider` because it renders when the root layout
 * may be the thing that broke, and the layout's providers are then not there.
 * "Go to the start" is a full page load on the web, which does not depend on
 * the router that may have just failed, and the router's own `replace` on a
 * phone.
 */
export type AppErrorBoundaryProps = {
  error: Error;
  retry: () => Promise<void>;
};

export function AppErrorBoundary({ error, retry }: AppErrorBoundaryProps) {
  // Reported during render, once per error: the screen shows the reference it
  // was reported under, and `reportClientError` returns the same one for the
  // same crash however often this renders (strict mode, a re-render loop).
  const reference = useMemo(() => reportClientError('boundary', error), [error]);

  const goHome = (): void => {
    if (Platform.OS === 'web' && typeof globalThis.location?.assign === 'function') {
      globalThis.location.assign('/');
      return;
    }
    try {
      router.replace('/');
    } catch {
      void retry();
    }
  };

  return (
    <SafeAreaProvider>
      <CrashScreen reference={reference} onTryAgain={() => void retry()} onGoHome={goHome} />
    </SafeAreaProvider>
  );
}
