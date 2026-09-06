import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { SignInScreen } from '../../src/features/identity/SignInScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SignInScreen fixture={fixture} onBack={() => router.back()} />;
}
