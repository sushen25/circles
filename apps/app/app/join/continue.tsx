import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { ContinueAsScreen } from '../../src/features/identity/ContinueAsScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <ContinueAsScreen fixture={fixture} onBack={() => router.back()} />;
}
