import { useRouter } from 'expo-router';

import { useFixture } from '../src/data/fixtures/useFixture';
import { AppSheetScreen } from '../src/features/growth/AppSheetScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <AppSheetScreen fixture={fixture} onBack={() => router.back()} />;
}
