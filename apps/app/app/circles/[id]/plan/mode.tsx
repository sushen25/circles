import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { ChooseModeScreen } from '../../../../src/features/planning/ChooseModeScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <ChooseModeScreen fixture={fixture} onBack={() => router.back()} />;
}
