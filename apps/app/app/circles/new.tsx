import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { FirstCircleScreen } from '../../src/features/circles/FirstCircleScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <FirstCircleScreen fixture={fixture} onBack={() => router.back()} />;
}
