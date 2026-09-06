import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { DeadlinePassedScreen } from '../../../../../src/features/scheduling/DeadlinePassedScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <DeadlinePassedScreen fixture={fixture} onBack={() => router.back()} />;
}
