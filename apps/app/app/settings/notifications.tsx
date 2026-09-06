import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { NotificationSettingsScreen } from '../../src/features/communication/NotificationSettingsScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <NotificationSettingsScreen fixture={fixture} onBack={() => router.back()} />;
}
