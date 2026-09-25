import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { brand } from '@circles/config';
import { fontAssets } from '@circles/tokens/font-assets';

import { configureAnalytics, flush } from '../src/analytics/track';
import { retryWhenReachable, trackEventsTransport } from '../src/analytics/transport';
import { startSessionTracking } from '../src/data/auth/session';
import { accessToken } from '../src/data/session';

void SplashScreen.preventAutoHideAsync();

// Once, at the root, before any screen can record anything. `track()` buffers
// until a transport exists; without this line every event in the product
// accumulates in memory and the funnel reads zero (architecture §15).
// `accessToken` is read on every send rather than captured once, so the events
// a guest records before signing in are attributed to nobody and everything
// after is attributed to them — without this module knowing when that happened.
// It returns nothing until the auth module (S1-14) calls `setAccessToken`.
configureAnalytics({ transport: trackEventsTransport({ accessToken }) });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Every screen refetches on focus. Nothing subscribes to Realtime —
      // it is out of scope for the MVP, and adding it is an ADR (§9.2).
      staleTime: 30_000,
      retry: 2,
    },
  },
});

export default function RootLayout() {
  // Newsreader and Figtree, one registered face per weight (see
  // `@circles/tokens` fonts.ts). If they fail to load we render anyway on the
  // metric-compatible fallbacks rather than holding the screen back.
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // A buffer only drains on the next `track()` otherwise, so somebody who
  // answers on a train and puts their phone away loses the session they were
  // counted for.
  useEffect(() => retryWhenReachable(flush), []);

  // Watches the session and pushes its token at `setAccessToken`, which is what
  // the comment above the `configureAnalytics` call has been waiting for: until
  // this ran, every event in the product was attributed to nobody. Also the one
  // place the session is read back from storage, so `useSession` has an answer
  // before any guard asks (§10).
  useEffect(() => startSessionTracking(), []);

  // Every page has a title, before the fonts too: a browser tab, a screen
  // reader's first words and WCAG 2.4.2 all need one, and axe calls a page
  // without it serious (S1-31's a11y spec).
  const title = (
    <Head>
      <title>{brand.name}</title>
    </Head>
  );

  if (!fontsLoaded && !fontError) {
    return title;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {title}
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
