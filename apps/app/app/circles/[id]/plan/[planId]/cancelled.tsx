import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { CancelledOrgScreen } from '../../../../../src/features/planning/CancelledOrgScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CancelledOrgScreen fixture={fixture} onBack={() => router.back()} />;
}
