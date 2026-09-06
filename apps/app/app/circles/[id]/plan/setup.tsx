import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { PlanSetupScreen } from '../../../../src/features/planning/PlanSetupScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <PlanSetupScreen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/shared')}
      onBack={() => router.back()}
    />
  );
}
