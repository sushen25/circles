import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { SaveAccessScreen } from '../../src/features/identity/SaveAccessScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SaveAccessScreen fixture={fixture} onBack={() => router.back()} />;
}
