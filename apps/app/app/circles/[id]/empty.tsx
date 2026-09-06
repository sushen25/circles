import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { EmptyCircleScreen } from '../../../src/features/circles/EmptyCircleScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <EmptyCircleScreen fixture={fixture} onBack={() => router.back()} />;
}
