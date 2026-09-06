import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { AvailabilityScreen } from '../../src/features/availability/AvailabilityScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <AvailabilityScreen fixture={fixture} onBack={() => router.back()} />;
}
