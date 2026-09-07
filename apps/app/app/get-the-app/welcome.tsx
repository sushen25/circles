import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { AppLandingScreen } from '../../src/features/growth/AppLandingScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <AppLandingScreen fixture={fixture} onBack={() => router.back()} />;
}
