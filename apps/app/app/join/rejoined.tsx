import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { ReattachedNudgeScreen } from '../../src/features/growth/ReattachedNudgeScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * The gallery's view of "Keep your place for good?". The real prompt is drawn
 * by the plan page's gate after a Continue-as (`ReattachedNudgeFlow`).
 */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <ReattachedNudgeScreen
      fixture={fixture}
      circleName={fixture.circle.name}
      name={fixture.name}
      onBack={() => router.back()}
      onCarryOn={() => router.back()}
      onNotNow={() => router.back()}
    />
  );
}
