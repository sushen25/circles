import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { PlanAnotherScreen } from '../../../../src/features/planning/PlanAnotherScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <PlanAnotherScreen fixture={fixture} onBack={() => router.back()} />;
}
