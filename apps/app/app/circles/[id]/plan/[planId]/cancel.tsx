import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { CancelPlanScreen } from '../../../../../src/features/planning/CancelPlanScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CancelPlanScreen fixture={fixture} onBack={() => router.back()} />;
}
