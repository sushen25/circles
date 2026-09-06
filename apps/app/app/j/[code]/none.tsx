import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { NoneWorkScreen } from '../../../src/features/availability/NoneWorkScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <NoneWorkScreen fixture={fixture} onBack={() => router.back()} />;
}
