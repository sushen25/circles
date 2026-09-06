import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { YourNameScreen } from '../../src/features/identity/YourNameScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <YourNameScreen fixture={fixture} onBack={() => router.back()} />;
}
