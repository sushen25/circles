import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { SettingsScreen } from '../../../src/features/circles/SettingsScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SettingsScreen fixture={fixture} onBack={() => router.back()} />;
}
