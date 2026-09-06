import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { EmptyCirclesListScreen } from '../../src/features/circles/EmptyCirclesListScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <EmptyCirclesListScreen fixture={fixture} onBack={() => router.back()} />;
}
