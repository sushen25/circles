import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { PushAskScreen } from '../../src/features/communication/PushAskScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <PushAskScreen fixture={fixture} onBack={() => router.back()} />;
}
