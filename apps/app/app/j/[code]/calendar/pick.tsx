import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { CalendarPickScreen } from '../../../../src/features/availability/CalendarPickScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CalendarPickScreen fixture={fixture} onBack={() => router.back()} />;
}
