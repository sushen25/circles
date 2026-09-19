import { useRouter } from 'expo-router';

import { EnterCodeScreen } from '../../src/features/identity/EnterCodeScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * The organiser's sign-in code step, still unwired: S1-22 (SUS-38) gives it a
 * flow. The screen itself is real since S1-30, which uses it to save a place.
 */
export default function Route() {
  const router = useRouter();

  return <EnterCodeScreen onBack={() => router.back()} />;
}
