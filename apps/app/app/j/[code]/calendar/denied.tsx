import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { CalendarDeniedScreen } from '../../../../src/features/availability/CalendarDeniedScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CalendarDeniedScreen fixture={fixture} onBack={() => router.back()} />;
}
