import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { SparkExpiredScreen } from '../../../../src/features/planning/SparkExpiredScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SparkExpiredScreen fixture={fixture} onBack={() => router.back()} />;
}
