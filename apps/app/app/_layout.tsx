import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { fontAssets } from '@circles/tokens/font-assets';

void SplashScreen.preventAutoHideAsync();

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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
