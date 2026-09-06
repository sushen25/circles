import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { ReattachedNudgeScreen } from '../../src/features/growth/ReattachedNudgeScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <ReattachedNudgeScreen fixture={fixture} onBack={() => router.back()} />;
}
