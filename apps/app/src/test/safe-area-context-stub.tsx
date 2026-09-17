import type { ReactNode } from 'react';

/**
 * `react-native-safe-area-context`, for jsdom. See the alias in
 * `vitest.config.ts` for why the real package cannot load here.
 */
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

export function useSafeAreaInsets() {
  return ZERO;
}

export function SafeAreaProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
