import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { ConfirmedGuestNudgeScreen } from '../../../src/features/growth/ConfirmedGuestNudgeScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <ConfirmedGuestNudgeScreen fixture={fixture} onBack={() => router.back()} />;
}
