import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { InviteCircleScreen } from '../../../src/features/circles/InviteCircleScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <InviteCircleScreen fixture={fixture} onBack={() => router.back()} />;
}
