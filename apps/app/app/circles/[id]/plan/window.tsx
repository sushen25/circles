import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { CustomWindowScreen } from '../../../../src/features/planning/CustomWindowScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CustomWindowScreen fixture={fixture} onBack={() => router.back()} />;
}
