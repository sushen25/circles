import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { WasThereScreen } from '../../../src/features/confirmation/WasThereScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <WasThereScreen fixture={fixture} onBack={() => router.back()} />;
}
