import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { CircleHomeDueScreen } from '../../../src/features/circles/CircleHomeDueScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CircleHomeDueScreen fixture={fixture} onBack={() => router.back()} />;
}
