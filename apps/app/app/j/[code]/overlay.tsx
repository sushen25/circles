import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { AvailabilityOverlayScreen } from '../../../src/features/availability/AvailabilityOverlayScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <AvailabilityOverlayScreen fixture={fixture} onBack={() => router.back()} />;
}
