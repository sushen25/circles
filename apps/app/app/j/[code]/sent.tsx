import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { SentScreen } from '../../../src/features/availability/SentScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SentScreen fixture={fixture} onBack={() => router.back()} />;
}
