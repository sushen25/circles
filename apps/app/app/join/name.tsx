import { useRouter } from 'expo-router';

import { hasBackend } from '../../src/data/auth/client';
import { useFixture } from '../../src/data/fixtures/useFixture';
import { NameScreen } from '../../src/features/identity/NameScreen';
import { NameFlow } from '../../src/features/identity/join/NameFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  return hasBackend() ? <NameFlow /> : <FixtureRoute />;
}

function FixtureRoute() {
  const router = useRouter();
  const fixture = useFixture();

  return <NameScreen fixture={fixture} onBack={() => router.back()} />;
}
