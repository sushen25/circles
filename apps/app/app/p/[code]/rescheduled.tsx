import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { RescheduledGuestScreen } from '../../../src/features/confirmation/RescheduledGuestScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <RescheduledGuestScreen fixture={fixture} onBack={() => router.back()} />;
}
