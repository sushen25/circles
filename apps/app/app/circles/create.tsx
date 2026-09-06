import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { CreateCircleScreen } from '../../src/features/circles/CreateCircleScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CreateCircleScreen fixture={fixture} onBack={() => router.back()} />;
}
