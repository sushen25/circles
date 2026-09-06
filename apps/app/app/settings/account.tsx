import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { AccountScreen } from '../../src/features/identity/AccountScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <AccountScreen fixture={fixture} onBack={() => router.back()} />;
}
