import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { ThresholdRoleScreen } from '../../../../src/features/planning/ThresholdRoleScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <ThresholdRoleScreen fixture={fixture} onBack={() => router.back()} />;
}
