import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { CircleHomeScreen } from '../../src/features/circles/CircleHomeScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <CircleHomeScreen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew/plan/setup')}
      onSeeHowItsLooking={() => router.push('/circles/sunday-crew/plan/thu-17/candidates')}
      onBack={() => router.back()}
    />
  );
}
