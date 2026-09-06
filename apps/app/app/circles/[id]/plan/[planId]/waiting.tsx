import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { WaitingScreen } from '../../../../../src/features/scheduling/WaitingScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <WaitingScreen fixture={fixture} onBack={() => router.back()} />;
}
