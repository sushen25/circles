import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { SecondSentScreen } from '../../../src/features/growth/SecondSentScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SecondSentScreen fixture={fixture} onBack={() => router.back()} />;
}
