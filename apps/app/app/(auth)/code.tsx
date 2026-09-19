import { Redirect, useRouter } from 'expo-router';

import { hasBackend } from '../../src/data/auth/client';
import { EnterCodeScreen } from '../../src/features/identity/EnterCodeScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * The code step lives inside `/sign-in` (`SignInFlow`), because the address it
 * was sent to is personal data and never travels in a URL. This route is the
 * gallery's view of the screen; a live build has nothing to show here and
 * sends anybody who lands on it to the start of sign-in.
 */
export default function Route() {
  const router = useRouter();
  if (hasBackend()) return <Redirect href="/sign-in" />;

  return <EnterCodeScreen address="maya@example.com" onBack={() => router.back()} />;
}
