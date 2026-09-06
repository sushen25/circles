import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { CircleHomeJoiningScreen } from '../../../src/features/circles/CircleHomeJoiningScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CircleHomeJoiningScreen fixture={fixture} onBack={() => router.back()} />;
}
