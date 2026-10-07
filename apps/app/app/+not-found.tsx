import { Stack } from 'expo-router';

import { NotFoundScreen } from '../src/features/system/NotFoundScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <NotFoundScreen />
    </>
  );
}
