import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { SparkSetupScreen } from '../../../../src/features/planning/SparkSetupScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SparkSetupScreen fixture={fixture} onBack={() => router.back()} />;
}
