import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { CalendarExplainScreen } from '../../../src/features/availability/CalendarExplainScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CalendarExplainScreen fixture={fixture} onBack={() => router.back()} />;
}
