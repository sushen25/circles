import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { SparkOpenedMemberScreen } from '../../../../src/features/planning/SparkOpenedMemberScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SparkOpenedMemberScreen fixture={fixture} onBack={() => router.back()} />;
}
