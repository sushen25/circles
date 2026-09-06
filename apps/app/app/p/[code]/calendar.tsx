import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { AddToCalendarScreen } from '../../../src/features/confirmation/AddToCalendarScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <AddToCalendarScreen fixture={fixture} onBack={() => router.back()} />;
}
