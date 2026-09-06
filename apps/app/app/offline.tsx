import { useRouter } from 'expo-router';

import { useFixture } from '../src/data/fixtures/useFixture';
import { OfflineScreen } from '../src/features/system/OfflineScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <OfflineScreen fixture={fixture} onBack={() => router.back()} />;
}
