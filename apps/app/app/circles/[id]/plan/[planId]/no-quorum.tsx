import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { NoQuorumScreen } from '../../../../../src/features/scheduling/NoQuorumScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <NoQuorumScreen fixture={fixture} onBack={() => router.back()} />;
}
